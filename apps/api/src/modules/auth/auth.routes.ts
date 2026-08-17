import { Router } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env.js';
import { unauthorized } from '../../lib/http-error.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authLimiter } from '../../middlewares/rate-limit.js';
import { asyncHandler, validate } from '../../middlewares/validate.js';
import * as authService from './auth.service.js';

export const authRouter: Router = Router();

const REFRESH_COOKIE = 'pareo_rt';

/**
 * O refresh vive em cookie httpOnly + Secure + SameSite=Strict.
 *
 *  · httpOnly  → um XSS não consegue lê-lo (é a diferença entre "roubaram a
 *                sessão de 15 min" e "roubaram a sessão de 30 dias").
 *  · Strict    → o cookie não acompanha navegação vinda de outro site, o que
 *                elimina CSRF na rota de refresh.
 *  · path      → só é enviado para as rotas de sessão, não em toda request.
 */
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

/**
 * Política de senha: comprimento acima de tudo.
 *
 * Exigir maiúscula + número + símbolo produz "Senha@123" — que está em todo
 * dicionário de ataque. 12 caracteres livres têm mais entropia real e o usuário
 * consegue lembrar. (NIST SP 800-63B chegou à mesma conclusão.)
 */
const passwordSchema = z
  .string()
  .min(12, 'A senha precisa ter ao menos 12 caracteres.')
  .max(72, 'A senha pode ter no máximo 72 caracteres.');

authRouter.post(
  '/register',
  authLimiter,
  validate({
    body: z.object({
      name: z.string().min(2).max(120),
      email: z.string().email().max(255),
      password: passwordSchema,
      householdName: z.string().min(2).max(120).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await authService.register({
      ...req.body,
      ctx: { userAgent: req.headers['user-agent'], ip: req.ip },
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.status(201).json(publicPayload(result));
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({
    body: z.object({
      email: z.string().email().max(255),
      password: z.string().min(1).max(72),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await authService.login({
      ...req.body,
      ctx: { userAgent: req.headers['user-agent'], ip: req.ip },
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json(publicPayload(result));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized('Sessão não encontrada.');

    const result = await authService.refresh({
      refreshToken: token,
      ctx: { userAgent: req.headers['user-agent'], ip: req.ip },
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json(publicPayload(result));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ auth: req.auth });
  }),
);

/** O refresh token nunca vai no corpo — só no cookie httpOnly. */
function publicPayload(result: authService.AuthResult) {
  return {
    accessToken: result.accessToken,
    user: result.user,
    household: result.household,
  };
}
