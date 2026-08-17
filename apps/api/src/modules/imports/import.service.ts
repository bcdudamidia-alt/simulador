import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { sha256 } from '../../lib/crypto.js';
import { badRequest, notFound, unprocessable } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import type { Cents } from '../../lib/money.js';
import { categorizeBatch } from '../ai/categorizer.service.js';
import { parseCsv } from './csv-parser.js';
import {
  buildDedupeHash,
  extractInstallment,
  normalizeDescription,
  toDisplayName,
} from './normalize.js';
import { OfxParseError, parseOfx, type OfxStatement } from './ofx-parser.js';

export interface ImportRequest {
  householdId: string;
  userId: string;
  file: { originalname: string; buffer: Buffer; mimetype: string };
  accountId?: string;
  creditCardId?: string;
}

export interface ImportResult {
  importBatchId: string;
  status: 'completed' | 'partial' | 'duplicate';
  totalRows: number;
  imported: number;
  duplicates: number;
  errors: number;
  needsReview: number;
  period: { start: string | null; end: string | null };
  warnings: string[];
}

/** Linha já parseada e normalizada, pronta para virar Transaction. */
interface StagedTransaction {
  postedAt: Date;
  competenceDate: Date;
  amountCents: Cents;
  description: string;
  normalizedDescription: string;
  fitid: string | null;
  dedupeHash: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const OFX_MAGIC = /^\s*(OFXHEADER|<\?xml|<OFX>)/i;

export async function importStatement(req: ImportRequest): Promise<ImportResult> {
  const { householdId, userId, file } = req;

  if (file.buffer.length === 0) throw badRequest('Arquivo vazio.');
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw badRequest(`Arquivo maior que ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  if ((req.accountId ? 1 : 0) + (req.creditCardId ? 1 : 0) !== 1) {
    throw badRequest('Informe exatamente um destino: accountId OU creditCardId.');
  }

  // O destino precisa ser do household do usuário. Sem esta checagem, o id no
  // corpo da request permitiria escrever transação na conta de outro casal.
  const origin = await resolveOrigin(householdId, req.accountId, req.creditCardId);

  // ── Idempotência: mesmo arquivo, mesmo household → não reimporta ──
  const fileHash = sha256(file.buffer);
  const existing = await prisma.importBatch.findUnique({
    where: { householdId_fileHash: { householdId, fileHash } },
  });
  if (existing) {
    return {
      importBatchId: existing.id,
      status: 'duplicate',
      totalRows: existing.totalRows,
      imported: 0,
      duplicates: existing.importedCount,
      errors: 0,
      needsReview: 0,
      period: {
        start: existing.statementStart?.toISOString().slice(0, 10) ?? null,
        end: existing.statementEnd?.toISOString().slice(0, 10) ?? null,
      },
      warnings: ['Este arquivo já foi importado anteriormente. Nada foi duplicado.'],
    };
  }

  const format = detectFormat(file);
  const parsed =
    format === 'ofx'
      ? stageFromOfx(file.buffer, origin)
      : stageFromCsv(file.buffer, origin);

  if (parsed.staged.length === 0) {
    throw unprocessable(
      'Nenhuma transação válida encontrada no arquivo.',
      parsed.warnings.slice(0, 10),
    );
  }

  const batch = await prisma.importBatch.create({
    data: {
      householdId,
      createdByUserId: userId,
      accountId: req.accountId ?? null,
      creditCardId: req.creditCardId ?? null,
      filename: file.originalname.slice(0, 255),
      fileHash,
      format,
      status: 'processing',
      totalRows: parsed.staged.length,
      statementStart: parsed.periodStart ? new Date(parsed.periodStart) : null,
      statementEnd: parsed.periodEnd ? new Date(parsed.periodEnd) : null,
    },
  });

  // ── Persistência ──
  // `skipDuplicates` faz o Postgres resolver o dedupe pelos índices únicos
  // (uq_tx_account_fitid e uq_tx_dedupe), em vez de um SELECT por linha.
  // Isso mantém a importação em uma ida ao banco mesmo com 2.000 transações.
  const rows: Prisma.TransactionCreateManyInput[] = parsed.staged.map((s) => ({
    householdId,
    accountId: req.accountId ?? null,
    creditCardId: req.creditCardId ?? null,
    importBatchId: batch.id,
    postedAt: s.postedAt,
    competenceDate: s.competenceDate,
    amountCents: s.amountCents,
    description: s.description,
    normalizedDescription: s.normalizedDescription,
    fitid: s.fitid,
    dedupeHash: s.dedupeHash,
    type: s.amountCents < 0n ? 'expense' : 'income',
    status: 'posted',
    needsReview: true, // sai false assim que a categorização resolver
    installmentNumber: s.installmentNumber,
    installmentTotal: s.installmentTotal,
    paidByUserId: userId,
  }));

  const inserted = await prisma.transaction.createMany({ data: rows, skipDuplicates: true });
  const duplicates = rows.length - inserted.count;

  // ── Saldo informado pelo banco ──
  if (parsed.balanceCents !== null && req.accountId) {
    await prisma.account.update({
      where: { id: req.accountId },
      data: {
        currentBalanceCents: parsed.balanceCents,
        balanceSyncedAt: parsed.balanceDate ? new Date(parsed.balanceDate) : new Date(),
      },
    });
  }

  // ── Categorização ──
  // Síncrona no MVP. Ao passar de ~500 transações por arquivo, isto vira job
  // (BullMQ) e o endpoint devolve 202 com o id do batch para polling.
  let needsReview = 0;
  try {
    const result = await categorizeBatch({ householdId, importBatchId: batch.id });
    needsReview = result.needsReview;
  } catch (error) {
    // Categorização é enriquecimento, não pré-requisito. Falhar aqui não pode
    // perder as transações que já entraram — elas ficam em "a revisar".
    logger.error({ error, batchId: batch.id }, 'categorização falhou; transações preservadas');
    parsed.warnings.push('As transações foram importadas, mas a categorização automática falhou.');
    needsReview = inserted.count;
  }

  const status = parsed.warnings.length > 0 ? 'partial' : 'completed';

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status,
      importedCount: inserted.count,
      duplicateCount: duplicates,
      errorCount: parsed.warnings.length,
      errorLog: parsed.warnings.length > 0 ? { warnings: parsed.warnings.slice(0, 100) } : undefined,
    },
  });

  logger.info(
    { batchId: batch.id, imported: inserted.count, duplicates, format },
    'importação concluída',
  );

  return {
    importBatchId: batch.id,
    status,
    totalRows: rows.length,
    imported: inserted.count,
    duplicates,
    errors: parsed.warnings.length,
    needsReview,
    period: { start: parsed.periodStart, end: parsed.periodEnd },
    warnings: parsed.warnings.slice(0, 20),
  };
}

// ───────────────────────────── helpers ─────────────────────────────

interface Origin {
  id: string;
  kind: 'account' | 'card';
  /** Dia de fechamento — define a competência da fatura */
  closingDay?: number;
}

async function resolveOrigin(
  householdId: string,
  accountId?: string,
  creditCardId?: string,
): Promise<Origin> {
  if (accountId) {
    const account = await prisma.account.findFirst({
      where: { id: accountId, householdId },
      select: { id: true },
    });
    if (!account) throw notFound('Conta não encontrada neste household.');
    return { id: account.id, kind: 'account' };
  }

  const card = await prisma.creditCard.findFirst({
    where: { id: creditCardId, householdId },
    select: { id: true, closingDay: true },
  });
  if (!card) throw notFound('Cartão não encontrado neste household.');
  return { id: card.id, kind: 'card', closingDay: card.closingDay };
}

function detectFormat(file: { originalname: string; buffer: Buffer }): 'ofx' | 'csv' {
  const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
  const head = file.buffer.subarray(0, 200).toString('latin1');

  // Magic bytes vencem a extensão: a extensão é escolhida por quem faz upload.
  if (OFX_MAGIC.test(head) || head.toUpperCase().includes('<OFX>')) return 'ofx';
  if (['ofx', 'qfx'].includes(ext)) return 'ofx';
  if (['csv', 'txt'].includes(ext)) return 'csv';

  throw badRequest('Formato não reconhecido. Envie um arquivo .ofx, .qfx ou .csv.');
}

interface StagedBatch {
  staged: StagedTransaction[];
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
  balanceCents: Cents | null;
  balanceDate: string | null;
}

function stageFromOfx(buffer: Buffer, origin: Origin): StagedBatch {
  let doc;
  try {
    doc = parseOfx(buffer);
  } catch (error) {
    if (error instanceof OfxParseError) throw unprocessable(error.message);
    throw error;
  }

  const warnings = [...doc.warnings];
  const staged: StagedTransaction[] = [];
  const seen = new Map<string, number>();

  // Arquivos com mais de um extrato existem (multi-conta). Importamos todos
  // para o destino escolhido e avisamos, em vez de descartar em silêncio.
  if (doc.statements.length > 1) {
    warnings.push(
      `O arquivo contém ${doc.statements.length} extratos; todos foram importados para o destino selecionado.`,
    );
  }

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let balanceCents: Cents | null = null;
  let balanceDate: string | null = null;

  for (const stmt of doc.statements) {
    periodStart = minDate(periodStart, stmt.periodStart);
    periodEnd = maxDate(periodEnd, stmt.periodEnd);
    if (stmt.balanceCents !== null) {
      balanceCents = stmt.balanceCents;
      balanceDate = stmt.balanceDate;
    }

    for (const trn of stmt.transactions) {
      staged.push(stage(trn.description, trn.postedAt, trn.amountCents, trn.fitid, origin, seen));
    }
  }

  return { staged, warnings, periodStart, periodEnd, balanceCents, balanceDate };
}

function stageFromCsv(buffer: Buffer, origin: Origin): StagedBatch {
  const parsed = parseCsv(buffer);
  const seen = new Map<string, number>();

  const staged = parsed.rows.map((row) =>
    stage(row.description, row.postedAt, row.amountCents, null, origin, seen),
  );

  const dates = parsed.rows.map((r) => r.postedAt).sort();

  return {
    staged,
    warnings: parsed.warnings,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    balanceCents: null,
    balanceDate: null,
  };
}

function stage(
  description: string,
  postedAt: string,
  amountCents: Cents,
  fitid: string | null,
  origin: Origin,
  seen: Map<string, number>,
): StagedTransaction {
  const installment = extractInstallment(description);
  const normalized = normalizeDescription(description);

  // Duas compras idênticas no mesmo dia são legítimas (dois cafés). O contador
  // de ocorrência garante hashes diferentes, sem perder a segunda transação.
  const key = `${postedAt}|${amountCents}|${normalized}`;
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);

  const postedDate = new Date(`${postedAt}T00:00:00Z`);

  return {
    postedAt: postedDate,
    competenceDate:
      origin.kind === 'card' && origin.closingDay
        ? statementCompetence(postedDate, origin.closingDay)
        : postedDate,
    amountCents,
    description: description.slice(0, 500),
    normalizedDescription: normalized.slice(0, 500),
    fitid,
    dedupeHash: buildDedupeHash({
      originId: origin.id,
      postedAt,
      amountCents,
      normalizedDescription: normalized,
      occurrence,
    }),
    installmentNumber: installment?.number ?? null,
    installmentTotal: installment?.total ?? null,
  };
}

/**
 * Competência da fatura: compra feita depois do fechamento cai na fatura do mês
 * seguinte. É o que faz "gastos de janeiro" no dashboard bater com a fatura
 * que o casal realmente vai pagar.
 */
function statementCompetence(postedAt: Date, closingDay: number): Date {
  const year = postedAt.getUTCFullYear();
  const month = postedAt.getUTCMonth();
  const day = postedAt.getUTCDate();
  return day > closingDay
    ? new Date(Date.UTC(year, month + 1, 1))
    : new Date(Date.UTC(year, month, 1));
}

const minDate = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a < b ? a : b;
const maxDate = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;

/** Reprocessa merchants a partir das transações já importadas (job de manutenção). */
export async function rebuildMerchants(householdId: string): Promise<number> {
  const transactions = await prisma.transaction.findMany({
    where: { householdId, merchantId: null },
    select: { id: true, normalizedDescription: true, categoryId: true },
    take: 5000,
  });

  let touched = 0;
  for (const tx of transactions) {
    const normalized = tx.normalizedDescription;
    if (!normalized) continue;

    const merchant = await prisma.merchant.upsert({
      where: { householdId_normalizedName: { householdId, normalizedName: normalized } },
      create: {
        householdId,
        normalizedName: normalized,
        displayName: toDisplayName(normalized),
        defaultCategoryId: tx.categoryId,
        seenCount: 1,
      },
      update: { seenCount: { increment: 1 } },
    });

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { merchantId: merchant.id },
    });
    touched++;
  }
  return touched;
}
