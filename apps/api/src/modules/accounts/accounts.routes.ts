import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { blindIndex, decrypt, encrypt } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/http-error.js';
import { requireWriteAccess } from '../../middlewares/authenticate.js';
import { asyncHandler, validate } from '../../middlewares/validate.js';

export const accountsRouter: Router = Router();

/**
 * Contas bancárias.
 *
 * O número da conta é o único campo sensível aqui e ele nunca sai da API em
 * claro: guardamos cifrado (`number_enc`) e devolvemos apenas os 4 últimos
 * dígitos. O blind index (`number_bidx`) existe para casar o `<ACCTID>` do
 * arquivo OFX com a conta certa sem precisar decifrar nada — e é ele que
 * permite, no futuro, o upload sem escolher a conta na mão.
 */

const accountBody = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(['checking', 'savings', 'investment', 'cash', 'other']).default('checking'),
  /** null = conta conjunta do casal */
  ownerUserId: z.string().uuid().nullable().default(null),
  institutionCode: z.string().max(20).optional(),
  institutionName: z.string().max(120).optional(),
  accountNumber: z.string().max(40).optional(),
  currentBalanceCents: z.number().int().default(0),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366F1'),
  icon: z.string().max(40).default('bank'),
});

/** Só os 4 últimos dígitos voltam para o cliente. Nunca o número inteiro. */
function maskNumber(enc: Uint8Array | null): string | null {
  if (!enc) return null;
  const plain = decrypt(Buffer.from(enc));
  return plain ? `••••${plain.slice(-4)}` : null;
}

const publicSelect = {
  id: true,
  name: true,
  type: true,
  color: true,
  icon: true,
  institutionCode: true,
  institutionName: true,
  currentBalanceCents: true,
  balanceSyncedAt: true,
  ownerUserId: true,
  isArchived: true,
  numberEnc: true,
  owner: { select: { id: true, name: true } },
} as const;

type RawAccount = { numberEnc: Uint8Array | null } & Record<string, unknown>;

function toPublic({ numberEnc, ...rest }: RawAccount) {
  return { ...rest, numberMasked: maskNumber(numberEnc) };
}

accountsRouter.get(
  '/',
  validate({ query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: {
        householdId: req.auth!.householdId,
        ...(req.query.includeArchived === 'true' ? {} : { isArchived: false }),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      select: publicSelect,
    });
    res.json({ data: accounts.map(toPublic) });
  }),
);

accountsRouter.post(
  '/',
  requireWriteAccess,
  validate({ body: accountBody }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;
    await assertMember(householdId, req.body.ownerUserId);

    const account = await prisma.account.create({
      data: {
        householdId,
        name: req.body.name,
        type: req.body.type,
        ownerUserId: req.body.ownerUserId,
        institutionCode: req.body.institutionCode ?? null,
        institutionName: req.body.institutionName ?? null,
        numberEnc: encrypt(req.body.accountNumber),
        numberBidx: blindIndex(req.body.accountNumber),
        currentBalanceCents: BigInt(req.body.currentBalanceCents),
        color: req.body.color,
        icon: req.body.icon,
      },
      select: publicSelect,
    });

    res.status(201).json(toPublic(account));
  }),
);

accountsRouter.patch(
  '/:id',
  requireWriteAccess,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: accountBody.partial(),
  }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;

    const existing = await prisma.account.findFirst({
      where: { id: req.params.id, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Conta não encontrada.');

    if (req.body.ownerUserId !== undefined) {
      await assertMember(householdId, req.body.ownerUserId);
    }

    const account = await prisma.account.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.type !== undefined ? { type: req.body.type } : {}),
        ...(req.body.ownerUserId !== undefined ? { ownerUserId: req.body.ownerUserId } : {}),
        ...(req.body.institutionCode !== undefined
          ? { institutionCode: req.body.institutionCode }
          : {}),
        ...(req.body.institutionName !== undefined
          ? { institutionName: req.body.institutionName }
          : {}),
        ...(req.body.accountNumber !== undefined
          ? {
              numberEnc: encrypt(req.body.accountNumber),
              numberBidx: blindIndex(req.body.accountNumber),
            }
          : {}),
        // O saldo só é editável na mão porque nem todo banco manda <LEDGERBAL>.
        // Quando o OFX traz o saldo, a importação sobrescreve este valor.
        ...(req.body.currentBalanceCents !== undefined
          ? { currentBalanceCents: BigInt(req.body.currentBalanceCents) }
          : {}),
        ...(req.body.color !== undefined ? { color: req.body.color } : {}),
        ...(req.body.icon !== undefined ? { icon: req.body.icon } : {}),
      },
      select: publicSelect,
    });

    res.json(toPublic(account));
  }),
);

/**
 * DELETE = arquivar, não apagar.
 *
 * Conta com histórico nunca é removida: apagá-la levaria junto todo o extrato
 * (`ON DELETE CASCADE`) e o comparativo mês a mês passaria a mentir. Só conta
 * sem nenhuma transação é de fato excluída.
 */
accountsRouter.delete(
  '/:id',
  requireWriteAccess,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;

    const account = await prisma.account.findFirst({
      where: { id: req.params.id, householdId },
      select: { id: true, _count: { select: { transactions: true } } },
    });
    if (!account) throw notFound('Conta não encontrada.');

    if (account._count.transactions === 0) {
      await prisma.account.delete({ where: { id: account.id } });
      res.json({ deleted: true, archived: false });
      return;
    }

    await prisma.account.update({ where: { id: account.id }, data: { isArchived: true } });
    res.json({
      deleted: false,
      archived: true,
      message: `A conta foi arquivada: ela tem ${account._count.transactions} lançamentos que continuam no histórico.`,
    });
  }),
);

/** Dono de conta individual precisa ser membro deste household. */
async function assertMember(householdId: string, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { userId: true },
  });
  if (!member) throw badRequest('O dono informado não é membro deste household.');
}

// ─────────────────────────────── cartões ───────────────────────────────

export const cardsRouter: Router = Router();

const cardBody = z.object({
  name: z.string().min(2).max(120),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other']).default('other'),
  ownerUserId: z.string().uuid().nullable().default(null),
  paymentAccountId: z.string().uuid().nullable().default(null),
  /** Só os 4 últimos dígitos. PAN completo e CVV são rejeitados pelo schema. */
  last4: z.string().regex(/^\d{4}$/, 'Informe exatamente os 4 últimos dígitos.').optional(),
  holderName: z.string().max(120).optional(),
  creditLimitCents: z.number().int().positive().nullable().default(null),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#8B5CF6'),
});

const cardSelect = {
  id: true,
  name: true,
  brand: true,
  color: true,
  creditLimitCents: true,
  closingDay: true,
  dueDay: true,
  ownerUserId: true,
  paymentAccountId: true,
  isArchived: true,
  last4Enc: true,
  owner: { select: { id: true, name: true } },
  paymentAccount: { select: { id: true, name: true } },
  statements: {
    orderBy: { referenceMonth: 'desc' as const },
    take: 3,
    select: {
      id: true,
      referenceMonth: true,
      dueDate: true,
      totalAmountCents: true,
      status: true,
    },
  },
} as const;

function cardToPublic({ last4Enc, ...rest }: { last4Enc: Uint8Array | null } & Record<string, unknown>) {
  return { ...rest, last4: last4Enc ? decrypt(Buffer.from(last4Enc)) : null };
}

cardsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const cards = await prisma.creditCard.findMany({
      where: { householdId: req.auth!.householdId, isArchived: false },
      orderBy: { name: 'asc' },
      select: cardSelect,
    });
    res.json({ data: cards.map(cardToPublic) });
  }),
);

cardsRouter.post(
  '/',
  requireWriteAccess,
  validate({ body: cardBody }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;
    await assertMember(householdId, req.body.ownerUserId);
    await assertOwnAccount(householdId, req.body.paymentAccountId);

    const card = await prisma.creditCard.create({
      data: {
        householdId,
        name: req.body.name,
        brand: req.body.brand,
        ownerUserId: req.body.ownerUserId,
        paymentAccountId: req.body.paymentAccountId,
        last4Enc: encrypt(req.body.last4),
        holderNameEnc: encrypt(req.body.holderName),
        creditLimitCents:
          req.body.creditLimitCents === null ? null : BigInt(req.body.creditLimitCents),
        closingDay: req.body.closingDay,
        dueDay: req.body.dueDay,
        color: req.body.color,
      },
      select: cardSelect,
    });

    res.status(201).json(cardToPublic(card));
  }),
);

cardsRouter.patch(
  '/:id',
  requireWriteAccess,
  validate({ params: z.object({ id: z.string().uuid() }), body: cardBody.partial() }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;

    const existing = await prisma.creditCard.findFirst({
      where: { id: req.params.id, householdId },
      select: { id: true },
    });
    if (!existing) throw notFound('Cartão não encontrado.');

    if (req.body.ownerUserId !== undefined) await assertMember(householdId, req.body.ownerUserId);
    if (req.body.paymentAccountId !== undefined) {
      await assertOwnAccount(householdId, req.body.paymentAccountId);
    }

    const card = await prisma.creditCard.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.brand !== undefined ? { brand: req.body.brand } : {}),
        ...(req.body.ownerUserId !== undefined ? { ownerUserId: req.body.ownerUserId } : {}),
        ...(req.body.paymentAccountId !== undefined
          ? { paymentAccountId: req.body.paymentAccountId }
          : {}),
        ...(req.body.last4 !== undefined ? { last4Enc: encrypt(req.body.last4) } : {}),
        ...(req.body.holderName !== undefined
          ? { holderNameEnc: encrypt(req.body.holderName) }
          : {}),
        ...(req.body.creditLimitCents !== undefined
          ? {
              creditLimitCents:
                req.body.creditLimitCents === null ? null : BigInt(req.body.creditLimitCents),
            }
          : {}),
        ...(req.body.closingDay !== undefined ? { closingDay: req.body.closingDay } : {}),
        ...(req.body.dueDay !== undefined ? { dueDay: req.body.dueDay } : {}),
        ...(req.body.color !== undefined ? { color: req.body.color } : {}),
      },
      select: cardSelect,
    });

    res.json(cardToPublic(card));
  }),
);

cardsRouter.delete(
  '/:id',
  requireWriteAccess,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;

    const card = await prisma.creditCard.findFirst({
      where: { id: req.params.id, householdId },
      select: { id: true, _count: { select: { transactions: true } } },
    });
    if (!card) throw notFound('Cartão não encontrado.');

    if (card._count.transactions === 0) {
      await prisma.creditCard.delete({ where: { id: card.id } });
      res.json({ deleted: true, archived: false });
      return;
    }

    await prisma.creditCard.update({ where: { id: card.id }, data: { isArchived: true } });
    res.json({
      deleted: false,
      archived: true,
      message: `O cartão foi arquivado: ele tem ${card._count.transactions} lançamentos no histórico.`,
    });
  }),
);

/** A conta de pagamento da fatura precisa ser do próprio household. */
async function assertOwnAccount(householdId: string, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return;
  const account = await prisma.account.findFirst({
    where: { id: accountId, householdId },
    select: { id: true },
  });
  if (!account) throw conflict('A conta de pagamento informada não pertence a este household.');
}
