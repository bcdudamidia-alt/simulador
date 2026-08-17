import { createApp } from './app.js';
import { aiEnabled, env } from './config/env.js';
import { disconnectPrisma, prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  // Falhar aqui é melhor do que subir e responder 500 na primeira request:
  // o orquestrador reinicia e o deploy não é marcado como saudável.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, ai: aiEnabled ? env.AI_MODEL : 'desabilitada' },
      `Pareo API em http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
  });

  /**
   * Shutdown gracioso.
   *
   * Sem isto, um deploy no meio de uma importação mata o processo com a
   * transação aberta. Aqui paramos de aceitar conexão nova, deixamos as em voo
   * terminarem e só então fechamos o pool.
   */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'encerrando…');

    const timeout = setTimeout(() => {
      logger.error('shutdown excedeu 15s; forçando saída');
      process.exit(1);
    }, 15_000);
    timeout.unref();

    server.close(() => {
      void disconnectPrisma().then(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'promise rejeitada sem tratamento');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ error }, 'falha ao iniciar a API');
  process.exit(1);
});
