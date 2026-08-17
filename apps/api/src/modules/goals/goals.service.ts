import { prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../../lib/http-error.js';

/**
 * Metas e projetos do casal.
 *
 * Duas decisões que sustentam o resto:
 *
 *  1. O acumulado NUNCA é coluna. É sempre
 *     `initial_amount + SUM(contributions)`. Saldo denormalizado é a origem
 *     número um de divergência em app financeiro — basta um aporte falhar
 *     depois do UPDATE e o número na tela deixa de existir no extrato.
 *
 *  2. A simulação ("quanto guardar por mês") roda no backend, não no frontend.
 *     O mesmo número aparece no dashboard, no e-mail mensal e no prompt de IA;
 *     duplicar a fórmula no cliente garante que os três divirjam.
 */

export interface GoalProgress {
  id: string;
  name: string;
  kind: string;
  color: string;
  icon: string;
  status: string;
  targetAmountCents: number;
  currentAmountCents: number;
  /** 0–100, limitado em 100 mesmo quando o casal passa da meta */
  progressPct: number;
  targetDate: string | null;
  monthsRemaining: number | null;
  /** Quanto precisa guardar por mês para chegar no prazo */
  requiredMonthlyCents: number;
  /** Média efetiva dos últimos 3 meses */
  averageMonthlyCents: number;
  contributedThisMonthCents: number;
  /** Projeção de término no ritmo atual; null se o ritmo é zero */
  projectedCompletion: string | null;
  pace: 'ahead' | 'on_track' | 'behind' | 'stalled' | 'achieved';
  /** Divisão dos aportes por membro — o "quem contribuiu com quanto" */
  byMember: Array<{ userId: string; name: string; amountCents: number; sharePct: number }>;
}

export async function getGoalProgress(
  householdId: string,
  goalId?: string,
): Promise<GoalProgress[]> {
  const goals = await prisma.goal.findMany({
    where: {
      householdId,
      ...(goalId ? { id: goalId } : { status: { in: ['active', 'paused'] } }),
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: {
      contributions: {
        select: {
          amountCents: true,
          contributedAt: true,
          userId: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));

  return goals.map((goal) => {
    const contributed = goal.contributions.reduce((sum, c) => sum + c.amountCents, 0n);
    const current = goal.initialAmountCents + contributed;
    const target = goal.targetAmountCents;
    const remaining = target - current > 0n ? target - current : 0n;

    const monthsRemaining = goal.targetDate ? monthsBetween(now, goal.targetDate) : null;

    // max(1) para não dividir por zero no mês do prazo — e porque "faltam 0
    // meses" na prática significa "é agora".
    const requiredMonthly =
      monthsRemaining === null ? 0n : remaining / BigInt(Math.max(1, monthsRemaining));

    const recent = goal.contributions.filter((c) => c.contributedAt >= threeMonthsAgo);
    const recentTotal = recent.reduce((sum, c) => sum + c.amountCents, 0n);
    const averageMonthly = recentTotal / 3n;

    const thisMonth = goal.contributions
      .filter((c) => c.contributedAt >= monthStart)
      .reduce((sum, c) => sum + c.amountCents, 0n);

    // Divisão por membro
    const memberTotals = new Map<string, { name: string; amount: bigint }>();
    for (const c of goal.contributions) {
      const entry = memberTotals.get(c.userId) ?? { name: c.user.name, amount: 0n };
      entry.amount += c.amountCents;
      memberTotals.set(c.userId, entry);
    }
    const totalContrib = contributed > 0n ? contributed : 1n;

    let pace: GoalProgress['pace'];
    if (current >= target) pace = 'achieved';
    else if (averageMonthly <= 0n) pace = 'stalled';
    else if (requiredMonthly === 0n) pace = 'on_track';
    else if (averageMonthly >= (requiredMonthly * 110n) / 100n) pace = 'ahead';
    else if (averageMonthly >= (requiredMonthly * 90n) / 100n) pace = 'on_track';
    else pace = 'behind';

    let projectedCompletion: string | null = null;
    if (remaining > 0n && averageMonthly > 0n) {
      const monthsNeeded = Number(remaining / averageMonthly) + 1;
      if (monthsNeeded < 600) {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsNeeded, 1));
        projectedCompletion = date.toISOString().slice(0, 10);
      }
    } else if (remaining === 0n) {
      projectedCompletion = now.toISOString().slice(0, 10);
    }

    return {
      id: goal.id,
      name: goal.name,
      kind: goal.kind,
      color: goal.color,
      icon: goal.icon,
      status: goal.status,
      targetAmountCents: Number(target),
      currentAmountCents: Number(current),
      progressPct: target > 0n ? Math.min(100, Number((current * 10000n) / target) / 100) : 0,
      targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
      monthsRemaining,
      requiredMonthlyCents: Number(goal.monthlyTargetCents ?? requiredMonthly),
      averageMonthlyCents: Number(averageMonthly),
      contributedThisMonthCents: Number(thisMonth),
      projectedCompletion,
      pace,
      byMember: [...memberTotals].map(([userId, { name, amount }]) => ({
        userId,
        name,
        amountCents: Number(amount),
        sharePct: Number((amount * 1000n) / totalContrib) / 10,
      })),
    };
  });
}

/**
 * Simulação "e se…": responde as duas perguntas que o casal realmente faz.
 *
 *   · "Guardando X por mês, quando chegamos lá?"
 *   · "Para chegar em tal data, quanto precisamos guardar?"
 */
export async function simulateGoal(input: {
  householdId: string;
  goalId: string;
  monthlyContributionCents?: number;
  targetDate?: string;
}): Promise<{
  scenario: 'by_amount' | 'by_date';
  requiredMonthlyCents: number;
  completionDate: string;
  monthsToComplete: number;
  totalToSaveCents: number;
  /** Diferença contra o ritmo atual — o número que motiva a decisão */
  deltaVsCurrentPaceCents: number;
}> {
  const [progress] = await getGoalProgress(input.householdId, input.goalId);
  if (!progress) throw notFound('Meta não encontrada.');

  const remaining = Math.max(0, progress.targetAmountCents - progress.currentAmountCents);
  const now = new Date();

  if (input.monthlyContributionCents != null) {
    if (input.monthlyContributionCents <= 0) {
      throw badRequest('O aporte mensal precisa ser maior que zero.');
    }
    const months = Math.ceil(remaining / input.monthlyContributionCents);
    const completion = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
    return {
      scenario: 'by_amount',
      requiredMonthlyCents: input.monthlyContributionCents,
      completionDate: completion.toISOString().slice(0, 10),
      monthsToComplete: months,
      totalToSaveCents: remaining,
      deltaVsCurrentPaceCents: input.monthlyContributionCents - progress.averageMonthlyCents,
    };
  }

  if (!input.targetDate) {
    throw badRequest('Informe monthlyContributionCents ou targetDate.');
  }

  const months = Math.max(1, monthsBetween(now, new Date(input.targetDate)));
  const required = Math.ceil(remaining / months);
  return {
    scenario: 'by_date',
    requiredMonthlyCents: required,
    completionDate: input.targetDate,
    monthsToComplete: months,
    totalToSaveCents: remaining,
    deltaVsCurrentPaceCents: required - progress.averageMonthlyCents,
  };
}

export async function addContribution(input: {
  householdId: string;
  goalId: string;
  userId: string;
  amountCents: number;
  contributedAt?: string;
  note?: string;
  transactionId?: string;
}): Promise<{ id: string; currentAmountCents: number }> {
  const goal = await prisma.goal.findFirst({
    where: { id: input.goalId, householdId: input.householdId },
    select: { id: true, targetAmountCents: true, status: true },
  });
  if (!goal) throw notFound('Meta não encontrada.');
  if (input.amountCents === 0) throw badRequest('O aporte não pode ser zero.');

  const contribution = await prisma.goalContribution.create({
    data: {
      householdId: input.householdId,
      goalId: input.goalId,
      userId: input.userId,
      amountCents: BigInt(input.amountCents),
      contributedAt: new Date(input.contributedAt ?? new Date().toISOString().slice(0, 10)),
      note: input.note ?? null,
      transactionId: input.transactionId ?? null,
    },
  });

  const [progress] = await getGoalProgress(input.householdId, input.goalId);

  // Marcar como atingida é automático: exigir que o usuário clique em "concluir"
  // deixa metas antigas poluindo o dashboard para sempre.
  if (progress && progress.currentAmountCents >= progress.targetAmountCents && goal.status === 'active') {
    await prisma.goal.update({ where: { id: goal.id }, data: { status: 'achieved' } });
  }

  return { id: contribution.id, currentAmountCents: progress?.currentAmountCents ?? 0 };
}

/** Meses cheios entre duas datas, nunca negativo. */
function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, months);
}
