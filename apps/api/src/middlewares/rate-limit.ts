import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Limites por tipo de rota.
 *
 * O limite de login é por IP **e** por e-mail: só por IP, um atacante atrás de
 * NAT corporativo derruba usuários legítimos; só por e-mail, ele varre uma
 * lista trocando de alvo a cada tentativa. A combinação fecha os dois.
 *
 * O store padrão é em memória, o que só serve para instância única. Ao escalar
 * horizontalmente, troque por `rate-limit-redis` — caso contrário o limite
 * efetivo passa a ser N × o configurado.
 */

const json = (message: string) => ({
  error: { code: 'RATE_LIMITED', message },
});

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Muitas requisições. Aguarde um instante.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // quem acerta a senha não gasta cota
  keyGenerator: (req: Request) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : 'anon';
    return `${req.ip ?? 'unknown'}:${email}`;
  },
  message: json('Muitas tentativas de login. Tente novamente em 15 minutos.'),
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.householdId ?? req.ip ?? 'unknown',
  message: json('Limite de importações por hora atingido.'),
});

/** IA custa dinheiro por chamada: o limite aqui protege a fatura, não o servidor. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.householdId ?? req.ip ?? 'unknown',
  message: json('Limite de análises por hora atingido.'),
});
