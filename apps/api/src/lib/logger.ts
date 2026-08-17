import pino from 'pino';
import { env, isProd } from '../config/env.js';

/**
 * Logger com redaction obrigatória.
 *
 * Em app financeiro, log é superfície de vazamento: ele vai para um agregador,
 * é lido por gente de plantão e fica retido por meses. Senha, token e número de
 * conta jamais podem chegar lá — por isso a redaction é do logger, não uma
 * disciplina de quem escreve a linha de log.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      '*.token',
      'numberEnc',
      'last4Enc',
      'holderNameEnc',
      'accountNumber',
      '*.accountNumber',
    ],
    censor: '[redacted]',
  },
  ...(isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
