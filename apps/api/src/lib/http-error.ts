/**
 * Erro de domínio com status HTTP.
 *
 * A mensagem de um HttpError é sempre segura para mostrar ao usuário final —
 * é isso que permite ao error-handler devolvê-la direto. Qualquer erro que não
 * seja HttpError vira 500 genérico, porque pode conter stack, SQL ou nome de
 * coluna, e nada disso deve vazar em um app financeiro.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, 'BAD_REQUEST', details);

export const unauthorized = (message = 'Não autenticado.'): HttpError =>
  new HttpError(401, message, 'UNAUTHORIZED');

export const forbidden = (message = 'Sem permissão para esta ação.'): HttpError =>
  new HttpError(403, message, 'FORBIDDEN');

export const notFound = (message = 'Recurso não encontrado.'): HttpError =>
  new HttpError(404, message, 'NOT_FOUND');

export const conflict = (message: string, details?: unknown): HttpError =>
  new HttpError(409, message, 'CONFLICT', details);

export const unprocessable = (message: string, details?: unknown): HttpError =>
  new HttpError(422, message, 'UNPROCESSABLE', details);

export const tooManyRequests = (message = 'Muitas tentativas. Tente novamente em instantes.'): HttpError =>
  new HttpError(429, message, 'RATE_LIMITED');
