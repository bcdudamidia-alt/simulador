import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { badRequest } from '../../lib/http-error.js';
import { requireWriteAccess } from '../../middlewares/authenticate.js';
import { uploadLimiter } from '../../middlewares/rate-limit.js';
import { asyncHandler, validate } from '../../middlewares/validate.js';
import { importStatement } from './import.service.js';

export const importsRouter: Router = Router();

const ALLOWED_EXTENSIONS = new Set(['ofx', 'qfx', 'csv', 'txt']);
const ALLOWED_MIMETYPES = new Set([
  'application/x-ofx',
  'application/vnd.intu.qfx',
  'application/octet-stream', // o que a maioria dos navegadores manda para .ofx
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel', // Excel marca .csv assim
]);

/**
 * Upload em memória, não em disco.
 *
 * Extrato bancário é dado sensível; gravar em `/tmp` cria uma cópia em texto
 * claro que sobrevive ao request e pode ser lida por qualquer processo do host.
 * Em memória, o buffer morre com o handler. O teto de 10 MB torna isso seguro —
 * um OFX de um ano inteiro raramente passa de 2 MB.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(badRequest(`Extensão .${ext} não permitida. Envie .ofx, .qfx ou .csv.`));
      return;
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      cb(badRequest(`Tipo de arquivo não permitido (${file.mimetype}).`));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /api/v1/imports
 * multipart/form-data: file + (accountId | creditCardId)
 */
importsRouter.post(
  '/',
  requireWriteAccess,
  uploadLimiter,
  upload.single('file'),
  validate({
    body: z
      .object({
        accountId: z.string().uuid().optional(),
        creditCardId: z.string().uuid().optional(),
      })
      .refine((v) => Boolean(v.accountId) !== Boolean(v.creditCardId), {
        message: 'Informe exatamente um destino: accountId OU creditCardId.',
      }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Nenhum arquivo enviado no campo "file".');

    const result = await importStatement({
      householdId: req.auth!.householdId,
      userId: req.auth!.userId,
      file: {
        originalname: req.file.originalname,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      },
      accountId: req.body.accountId,
      creditCardId: req.body.creditCardId,
    });

    // 200 para arquivo repetido (nada mudou), 201 quando houve criação.
    res.status(result.status === 'duplicate' ? 200 : 201).json(result);
  }),
);

/** GET /api/v1/imports — histórico de importações */
importsRouter.get(
  '/',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const batches = await prisma.importBatch.findMany({
      where: { householdId: req.auth!.householdId },
      orderBy: { createdAt: 'desc' },
      take: Number(req.query.limit),
      select: {
        id: true,
        filename: true,
        format: true,
        status: true,
        totalRows: true,
        importedCount: true,
        duplicateCount: true,
        errorCount: true,
        statementStart: true,
        statementEnd: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
        creditCard: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
    });
    res.json({ data: batches });
  }),
);

/**
 * DELETE /api/v1/imports/:id — desfaz uma importação.
 *
 * Só apaga transações que ainda não foram tocadas pelo usuário
 * (`categorySource` diferente de 'user'). Uma transação que ele categorizou,
 * dividiu ou anotou já carrega trabalho manual; apagá-la porque o arquivo de
 * origem foi removido seria destruir dado que ele não pediu para destruir.
 */
importsRouter.delete(
  '/:id',
  requireWriteAccess,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;
    const batchId = req.params.id!;

    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, householdId },
      select: { id: true },
    });
    if (!batch) throw badRequest('Importação não encontrada.');

    const deleted = await prisma.transaction.deleteMany({
      where: {
        householdId,
        importBatchId: batchId,
        categorySource: { not: 'user' },
        notes: null,
      },
    });

    const remaining = await prisma.transaction.count({
      where: { householdId, importBatchId: batchId },
    });

    if (remaining === 0) {
      await prisma.importBatch.delete({ where: { id: batchId } });
    }

    res.json({
      deleted: deleted.count,
      kept: remaining,
      message:
        remaining > 0
          ? `${remaining} transação(ões) foram mantidas porque você as editou manualmente.`
          : 'Importação desfeita.',
    });
  }),
);
