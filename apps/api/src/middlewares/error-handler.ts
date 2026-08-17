import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { isProd } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

/**
 * Tradutor final de erro → resposta JSON.
 *
 * Princípio: só HttpError tem mensagem exibível. Qualquer outro erro vira 500
 * genérico, porque pode carregar stack, SQL, nome de coluna ou valor de linha —
 * e em app financeiro isso é reconhecimento de terreno de graça para um atacante.
 * O detalhe vai para o log, com um `errorId` que o suporte usa para correlacionar.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 = violação de unique. Comum e esperado (ex.: reimportar arquivo).
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'Este registro já existe.' },
      });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' },
      });
      return;
    }
  }

  // multer sinaliza arquivo grande demais com um code próprio.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code: string }).code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', message: 'Arquivo maior que o limite permitido.' },
      });
      return;
    }
  }

  const errorId = crypto.randomUUID();
  logger.error(
    { err: error, errorId, path: req.path, method: req.method, userId: req.auth?.userId },
    'erro não tratado',
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno. Se persistir, informe o código abaixo ao suporte.',
      errorId,
      ...(isProd ? {} : { debug: error instanceof Error ? error.message : String(error) }),
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Rota ${req.method} ${req.path} não existe.` },
  });
}
