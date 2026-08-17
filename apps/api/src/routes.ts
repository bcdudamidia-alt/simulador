import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db/prisma.js';
import { notFound } from './lib/http-error.js';
import { authenticate, requireWriteAccess, withHousehold } from './middlewares/authenticate.js';
import { aiLimiter } from './middlewares/rate-limit.js';
import { asyncHandler, validate } from './middlewares/validate.js';
import { learnFromCorrection } from './modules/ai/categorizer.service.js';
import { generateMonthlyInsights } from './modules/ai/insights.service.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { getDashboard } from './modules/dashboard/dashboard.service.js';
import { addContribution, getGoalProgress, simulateGoal } from './modules/goals/goals.service.js';
import { importsRouter } from './modules/imports/imports.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);

// Tudo abaixo exige sessão válida E associação confirmada ao household.
const protectedRouter: Router = Router();
protectedRouter.use(authenticate, withHousehold);
apiRouter.use(protectedRouter);

protectedRouter.use('/imports', importsRouter);

// ─────────────────────────────── dashboard ───────────────────────────────

protectedRouter.get(
  '/dashboard',
  validate({
    query: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'Use o formato YYYY-MM.').optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await getDashboard(req.auth!.householdId, req.query.month as string | undefined));
  }),
);

// ────────────────────────────── contas e cartões ──────────────────────────────

protectedRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: { householdId: req.auth!.householdId, isArchived: false },
      orderBy: { name: 'asc' },
      // `select` explícito: number_enc jamais deve sair da API sem decisão
      // deliberada. `include` traria a coluna cifrada para o JSON sem querer.
      select: {
        id: true,
        name: true,
        type: true,
        color: true,
        icon: true,
        institutionName: true,
        currentBalanceCents: true,
        balanceSyncedAt: true,
        ownerUserId: true,
        owner: { select: { id: true, name: true } },
      },
    });
    res.json({ data: accounts });
  }),
);

protectedRouter.get(
  '/cards',
  asyncHandler(async (req, res) => {
    const cards = await prisma.creditCard.findMany({
      where: { householdId: req.auth!.householdId, isArchived: false },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        brand: true,
        color: true,
        creditLimitCents: true,
        closingDay: true,
        dueDay: true,
        owner: { select: { id: true, name: true } },
        statements: {
          orderBy: { referenceMonth: 'desc' },
          take: 3,
          select: {
            id: true,
            referenceMonth: true,
            dueDate: true,
            totalAmountCents: true,
            status: true,
          },
        },
      },
    });
    res.json({ data: cards });
  }),
);

// ─────────────────────────────── transações ───────────────────────────────

protectedRouter.get(
  '/transactions',
  validate({
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      categoryId: z.string().uuid().optional(),
      accountId: z.string().uuid().optional(),
      creditCardId: z.string().uuid().optional(),
      needsReview: z.enum(['true', 'false']).optional(),
      search: z.string().max(120).optional(),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Number(q.limit ?? 50);

    const transactions = await prisma.transaction.findMany({
      where: {
        householdId: req.auth!.householdId,
        ...(q.from || q.to
          ? {
              postedAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.accountId ? { accountId: q.accountId } : {}),
        ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
        ...(q.needsReview ? { needsReview: q.needsReview === 'true' } : {}),
        // `contains` do Prisma vira LIKE parametrizado — não há injeção aqui.
        ...(q.search ? { description: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // uma a mais para saber se existe próxima página
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        description: true,
        amountCents: true,
        postedAt: true,
        competenceDate: true,
        type: true,
        sharing: true,
        needsReview: true,
        categorySource: true,
        categoryConfidence: true,
        installmentNumber: true,
        installmentTotal: true,
        category: { select: { id: true, name: true, slug: true, color: true, icon: true } },
        account: { select: { id: true, name: true, color: true } },
        creditCard: { select: { id: true, name: true, color: true } },
        paidBy: { select: { id: true, name: true } },
      },
    });

    const hasMore = transactions.length > limit;
    const data = hasMore ? transactions.slice(0, limit) : transactions;

    res.json({
      data,
      pagination: { hasMore, nextCursor: hasMore ? data[data.length - 1]?.id : null },
    });
  }),
);

/**
 * PATCH /transactions/:id/category — correção de categoria.
 *
 * Com `applyToSimilar`, a correção vira regra e reclassifica as irmãs. É o
 * ciclo de aprendizado do produto: o usuário corrige uma vez, não toda vez.
 */
protectedRouter.patch(
  '/transactions/:id/category',
  requireWriteAccess,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      categoryId: z.string().uuid(),
      applyToSimilar: z.boolean().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const householdId = req.auth!.householdId;

    // A categoria precisa ser deste household. Sem esta checagem, um id de
    // categoria de outro casal seria aceito pela FK sem reclamar.
    const category = await prisma.category.findFirst({
      where: { id: req.body.categoryId, householdId },
      select: { id: true },
    });
    if (!category) throw notFound('Categoria não encontrada.');

    res.json(
      await learnFromCorrection({
        householdId,
        transactionId: req.params.id!,
        categoryId: req.body.categoryId,
        applyToSimilar: req.body.applyToSimilar,
      }),
    );
  }),
);

protectedRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { householdId: req.auth!.householdId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, kind: true, color: true, icon: true },
    });
    res.json({ data: categories });
  }),
);

// ─────────────────────────────── metas ───────────────────────────────

protectedRouter.get(
  '/goals',
  asyncHandler(async (req, res) => {
    res.json({ data: await getGoalProgress(req.auth!.householdId) });
  }),
);

protectedRouter.post(
  '/goals',
  requireWriteAccess,
  validate({
    body: z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
      kind: z
        .enum(['wedding', 'property', 'travel', 'emergency_fund', 'vehicle', 'education', 'other'])
        .default('other'),
      targetAmountCents: z.number().int().positive(),
      initialAmountCents: z.number().int().min(0).default(0),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      monthlyTargetCents: z.number().int().positive().optional(),
      priority: z.number().int().min(1).max(10).default(1),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#10B981'),
      icon: z.string().max(40).default('target'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const goal = await prisma.goal.create({
      data: {
        householdId: req.auth!.householdId,
        createdByUserId: req.auth!.userId,
        name: req.body.name,
        description: req.body.description ?? null,
        kind: req.body.kind,
        targetAmountCents: BigInt(req.body.targetAmountCents),
        initialAmountCents: BigInt(req.body.initialAmountCents),
        targetDate: req.body.targetDate ? new Date(req.body.targetDate) : null,
        monthlyTargetCents: req.body.monthlyTargetCents
          ? BigInt(req.body.monthlyTargetCents)
          : null,
        priority: req.body.priority,
        color: req.body.color,
        icon: req.body.icon,
      },
      select: { id: true },
    });

    const [progress] = await getGoalProgress(req.auth!.householdId, goal.id);
    res.status(201).json(progress);
  }),
);

protectedRouter.post(
  '/goals/:id/contributions',
  requireWriteAccess,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      amountCents: z.number().int(),
      contributedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      note: z.string().max(280).optional(),
      transactionId: z.string().uuid().optional(),
      /** Permite lançar o aporte em nome do parceiro(a). */
      userId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await addContribution({
        householdId: req.auth!.householdId,
        goalId: req.params.id!,
        userId: req.body.userId ?? req.auth!.userId,
        amountCents: req.body.amountCents,
        contributedAt: req.body.contributedAt,
        note: req.body.note,
        transactionId: req.body.transactionId,
      }),
    );
  }),
);

/** Simulação "quanto guardar por mês" / "quando chegamos lá". */
protectedRouter.post(
  '/goals/:id/simulate',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z
      .object({
        monthlyContributionCents: z.number().int().positive().optional(),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .refine((v) => Boolean(v.monthlyContributionCents) !== Boolean(v.targetDate), {
        message: 'Informe monthlyContributionCents OU targetDate, não os dois.',
      }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await simulateGoal({
        householdId: req.auth!.householdId,
        goalId: req.params.id!,
        monthlyContributionCents: req.body.monthlyContributionCents,
        targetDate: req.body.targetDate,
      }),
    );
  }),
);

// ─────────────────────────────── IA ───────────────────────────────

protectedRouter.get(
  '/insights/:month',
  aiLimiter,
  validate({
    params: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
    query: z.object({ force: z.enum(['true', 'false']).optional() }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await generateMonthlyInsights({
        householdId: req.auth!.householdId,
        referenceMonth: req.params.month!,
        force: req.query.force === 'true',
      }),
    );
  }),
);
