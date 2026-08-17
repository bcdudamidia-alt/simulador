import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { badRequest } from '../lib/http-error.js';

/**
 * Validação de entrada com zod.
 *
 * Toda rota que recebe dado do cliente passa por aqui. O ganho não é só
 * ergonomia: o objeto validado SUBSTITUI o original, então um campo extra que o
 * cliente mandou (`{ role: "owner" }` em um update de perfil) não chega ao
 * service. Isso fecha mass assignment por construção, e não por disciplina.
 */
export function validate(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          badRequest(
            'Dados inválidos.',
            error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
          ),
        );
        return;
      }
      next(error);
    }
  };
}

/** Envolve handler async para que rejeição vire `next(error)`. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
