import { prisma } from '../../db/prisma.js';
import { getGoalProgress, type GoalProgress } from '../goals/goals.service.js';

/**
 * Agregações do dashboard.
 *
 * Tudo em SQL, em paralelo, em uma única chamada. O frontend não faz conta: ele
 * recebe números prontos. Isso não é só performance — é a garantia de que o
 * total do gráfico de pizza bate com o KPI do topo, porque os dois vieram da
 * mesma query.
 *
 * `$queryRaw` com template tag: o Prisma parametriza as interpolações
 * (`${...}` vira `$1`), então não há caminho para SQL injection aqui. Uma
 * concatenação de string (`$queryRawUnsafe`) abriria exatamente esse caminho —
 * e por isso ela não é usada em lugar nenhum deste projeto.
 */

export interface DashboardSummary {
  referenceMonth: string;
  totals: {
    /** Soma dos saldos de todas as contas não arquivadas */
    consolidatedBalanceCents: number;
    monthIncomeCents: number;
    monthExpensesCents: number;
    monthBalanceCents: number;
    savingsRatePct: number;
    /** Faturas em aberto ou fechadas e ainda não pagas */
    openCardTotalCents: number;
    /** Parcelas já lançadas que vencem depois deste mês */
    futureCommitmentsCents: number;
  };
  comparison: {
    incomeChangePct: number;
    expenseChangePct: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    color: string;
    balanceCents: number;
    ownerName: string | null;
    isShared: boolean;
  }>;
  cards: Array<{
    id: string;
    name: string;
    brand: string;
    color: string;
    currentStatementCents: number;
    limitCents: number | null;
    usagePct: number | null;
    dueDate: string | null;
    status: string;
  }>;
  expensesByCategory: Array<{
    slug: string;
    name: string;
    color: string;
    totalCents: number;
    sharePct: number;
    previousTotalCents: number;
  }>;
  cashFlow: Array<{ month: string; incomeCents: number; expensesCents: number; balanceCents: number }>;
  /** Projeção do mês: realizado + recorrentes ainda não lançados + parcelas */
  projection: {
    realizedCents: number;
    projectedTotalCents: number;
    dayOfMonth: number;
    daysInMonth: number;
  };
  goals: GoalProgress[];
  pendingReviewCount: number;
  recentTransactions: Array<{
    id: string;
    description: string;
    amountCents: number;
    postedAt: string;
    categoryName: string | null;
    categoryColor: string | null;
    origin: string;
    needsReview: boolean;
  }>;
}

export async function getDashboard(
  householdId: string,
  referenceMonth?: string,
): Promise<DashboardSummary> {
  const now = new Date();
  const month = referenceMonth
    ? new Date(`${referenceMonth}-01T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const prevStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
  const sixMonthsAgo = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 5, 1));

  const [
    accounts,
    cards,
    monthTotals,
    prevTotals,
    byCategory,
    prevByCategory,
    cashFlow,
    goals,
    pendingReview,
    recent,
    futureCommitments,
  ] = await Promise.all([
    prisma.account.findMany({
      where: { householdId, isArchived: false },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        color: true,
        currentBalanceCents: true,
        ownerUserId: true,
        owner: { select: { name: true } },
      },
    }),

    prisma.creditCard.findMany({
      where: { householdId, isArchived: false },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        brand: true,
        color: true,
        creditLimitCents: true,
        statements: {
          where: { status: { in: ['open', 'closed', 'overdue'] } },
          orderBy: { referenceMonth: 'desc' },
          take: 1,
          select: { totalAmountCents: true, dueDate: true, status: true },
        },
      },
    }),

    monthAggregate(householdId, month, monthEnd),
    monthAggregate(householdId, prevStart, month),

    categoryBreakdown(householdId, month, monthEnd),
    categoryBreakdown(householdId, prevStart, month),

    prisma.$queryRaw<Array<{ month: Date; income: bigint | null; expenses: bigint | null }>>`
      SELECT date_trunc('month', t.competence_date)::date AS month,
             SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0) AS income,
             SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0) AS expenses
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ${householdId}::uuid
         AND t.competence_date >= ${sixMonthsAgo}
         AND t.competence_date <  ${monthEnd}
         AND COALESCE(c.kind::text, 'expense') <> 'transfer'
       GROUP BY 1
       ORDER BY 1`,

    getGoalProgress(householdId),

    prisma.transaction.count({
      where: { householdId, needsReview: true, competenceDate: { gte: month, lt: monthEnd } },
    }),

    // Escopado pelo mês de referência, como todo o resto do painel. Uma lista
    // "recente" que ignora o seletor de mês faz a visão de agosto exibir
    // lançamento de setembro — e o casal deixa de confiar no que está vendo.
    prisma.transaction.findMany({
      where: { householdId, competenceDate: { gte: month, lt: monthEnd } },
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
      take: 8,
      select: {
        id: true,
        description: true,
        amountCents: true,
        postedAt: true,
        needsReview: true,
        category: { select: { name: true, color: true } },
        account: { select: { name: true } },
        creditCard: { select: { name: true } },
      },
    }),

    prisma.transaction.aggregate({
      where: { householdId, competenceDate: { gte: monthEnd }, amountCents: { lt: 0 } },
      _sum: { amountCents: true },
    }),
  ]);

  const consolidatedBalance = accounts.reduce((sum, a) => sum + Number(a.currentBalanceCents), 0);
  const openCardTotal = cards.reduce(
    (sum, c) => sum + Number(c.statements[0]?.totalAmountCents ?? 0),
    0,
  );

  const totalExpenses = byCategory.reduce((sum, c) => sum + c.totalCents, 0);
  const prevByCategoryMap = new Map(prevByCategory.map((c) => [c.slug, c.totalCents]));

  // Projeção linear simples do mês: gasto médio por dia decorrido × dias do mês.
  // É deliberadamente ingênua e o frontend a rotula como estimativa — um modelo
  // sofisticado aqui daria falsa precisão sem mudar nenhuma decisão do casal.
  const isCurrentMonth =
    month.getUTCFullYear() === now.getUTCFullYear() && month.getUTCMonth() === now.getUTCMonth();
  const daysInMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dayOfMonth = isCurrentMonth ? now.getUTCDate() : daysInMonth;
  const projectedTotal =
    dayOfMonth > 0 ? Math.round((totalExpenses / dayOfMonth) * daysInMonth) : totalExpenses;

  return {
    referenceMonth: month.toISOString().slice(0, 7),
    totals: {
      consolidatedBalanceCents: consolidatedBalance,
      monthIncomeCents: monthTotals.income,
      monthExpensesCents: monthTotals.expenses,
      monthBalanceCents: monthTotals.income - monthTotals.expenses,
      savingsRatePct:
        monthTotals.income > 0
          ? Number((((monthTotals.income - monthTotals.expenses) / monthTotals.income) * 100).toFixed(1))
          : 0,
      openCardTotalCents: openCardTotal,
      futureCommitmentsCents: Math.abs(Number(futureCommitments._sum.amountCents ?? 0)),
    },
    comparison: {
      incomeChangePct: pctChange(monthTotals.income, prevTotals.income),
      expenseChangePct: pctChange(monthTotals.expenses, prevTotals.expenses),
    },
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      color: a.color,
      balanceCents: Number(a.currentBalanceCents),
      ownerName: a.owner?.name ?? null,
      isShared: a.ownerUserId === null,
    })),
    cards: cards.map((c) => {
      const statement = c.statements[0];
      const current = Number(statement?.totalAmountCents ?? 0);
      const limit = c.creditLimitCents ? Number(c.creditLimitCents) : null;
      return {
        id: c.id,
        name: c.name,
        brand: c.brand,
        color: c.color,
        currentStatementCents: Math.abs(current),
        limitCents: limit,
        usagePct: limit ? Number(((Math.abs(current) / limit) * 100).toFixed(1)) : null,
        dueDate: statement?.dueDate.toISOString().slice(0, 10) ?? null,
        status: statement?.status ?? 'open',
      };
    }),
    expensesByCategory: byCategory.map((c) => ({
      ...c,
      sharePct: totalExpenses > 0 ? Number(((c.totalCents / totalExpenses) * 100).toFixed(1)) : 0,
      previousTotalCents: prevByCategoryMap.get(c.slug) ?? 0,
    })),
    cashFlow: cashFlow.map((row) => {
      const income = Number(row.income ?? 0);
      const expenses = Math.abs(Number(row.expenses ?? 0));
      return {
        month: row.month.toISOString().slice(0, 7),
        incomeCents: income,
        expensesCents: expenses,
        balanceCents: income - expenses,
      };
    }),
    projection: {
      realizedCents: totalExpenses,
      projectedTotalCents: projectedTotal,
      dayOfMonth,
      daysInMonth,
    },
    goals,
    pendingReviewCount: pendingReview,
    recentTransactions: recent.map((t) => ({
      id: t.id,
      description: t.description,
      amountCents: Number(t.amountCents),
      postedAt: t.postedAt.toISOString().slice(0, 10),
      categoryName: t.category?.name ?? null,
      categoryColor: t.category?.color ?? null,
      origin: t.account?.name ?? t.creditCard?.name ?? '—',
      needsReview: t.needsReview,
    })),
  };
}

async function monthAggregate(
  householdId: string,
  start: Date,
  end: Date,
): Promise<{ income: number; expenses: number }> {
  const [row] = await prisma.$queryRaw<Array<{ income: bigint | null; expenses: bigint | null }>>`
    SELECT SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0) AS income,
           SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0) AS expenses
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.household_id = ${householdId}::uuid
       AND t.competence_date >= ${start}
       AND t.competence_date <  ${end}
       AND COALESCE(c.kind::text, 'expense') <> 'transfer'`;

  return {
    income: Number(row?.income ?? 0),
    expenses: Math.abs(Number(row?.expenses ?? 0)),
  };
}

async function categoryBreakdown(
  householdId: string,
  start: Date,
  end: Date,
): Promise<Array<{ slug: string; name: string; color: string; totalCents: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ slug: string; name: string; color: string; total: bigint }>
  >`
    SELECT COALESCE(c.slug,  'outros.sem-categoria') AS slug,
           COALESCE(c.name,  'Sem categoria')        AS name,
           COALESCE(c.color, '#94A3B8')              AS color,
           SUM(t.amount_cents)                       AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.household_id = ${householdId}::uuid
       AND t.competence_date >= ${start}
       AND t.competence_date <  ${end}
       AND t.amount_cents < 0
       AND COALESCE(c.kind::text, 'expense') <> 'transfer'
     GROUP BY 1, 2, 3
     ORDER BY SUM(t.amount_cents) ASC`;

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    color: r.color,
    totalCents: Math.abs(Number(r.total)),
  }));
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}
