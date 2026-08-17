import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { installBigIntJsonSerializer } from './lib/money.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { globalLimiter } from './middlewares/rate-limit.js';
import { apiRouter } from './routes.js';

installBigIntJsonSerializer();

export function createApp(): Express {
  const app = express();

  // Atrás de load balancer, sem isto `req.ip` seria sempre o IP do proxy — e o
  // rate limit por IP viraria um limite global compartilhado.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"], // a API só serve JSON: nada precisa ser carregado
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      // HSTS por 1 ano: depois da primeira visita, o navegador se recusa a
      // falar HTTP com este host, o que fecha downgrade em rede hostil.
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Origem em allowlist explícita. `credentials: true` é obrigatório para o
  // cookie de refresh, e o par (credentials + origin curinga) é proibido pelo
  // navegador justamente por isso — nunca troque por `origin: true`.
  app.use(
    cors({
      origin: [env.WEB_ORIGIN],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 86_400,
    }),
  );

  // Limite de corpo baixo: a única rota que recebe volume é o upload, e ela usa
  // multer com o próprio limite. 100 kb aqui evita corpo JSON gigante como DoS.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use(globalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
