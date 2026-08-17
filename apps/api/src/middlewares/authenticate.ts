import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { forbidden, unauthorized } from '../lib/http-error.js';
import { verifyAccessToken } from '../lib/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; householdId: string; role: string };
    }
  }
}

/** Valida o access token e injeta `req.auth`. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Token de acesso ausente.');
    }

    const claims = await verifyAccessToken(header.slice(7));
    req.auth = {
      userId: claims.sub,
      householdId: claims.householdId,
      role: claims.role ?? 'partner',
    };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Reconfirma no banco que o usuário ainda pertence ao household do token.
 *
 * Sem isto, quem foi removido do household continuaria com acesso pelos 15 min
 * de validade do access token — tempo de sobra para exportar o extrato do casal
 * depois de uma separação. É uma query indexada por chave primária composta;
 * o custo é irrelevante perto do risco.
 */
export async function withHousehold(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) throw unauthorized();

    const membership = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: req.auth.householdId, userId: req.auth.userId },
      },
      select: { role: true },
    });

    if (!membership) throw forbidden('Você não tem mais acesso a este household.');

    req.auth.role = membership.role; // o papel do banco vence o do token
    next();
  } catch (error) {
    next(error);
  }
}

/** Bloqueia escrita para o papel `viewer` (contador, planejador). */
export function requireWriteAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.auth?.role === 'viewer') {
    next(forbidden('Seu perfil tem acesso somente de leitura.'));
    return;
  }
  next();
}
