import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { aiEnabled, env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { badRequest } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { getGoalProgress } from '../goals/goals.service.js';
import {
  INSIGHTS_SYSTEM_PROMPT,
  buildInsightsUserPrompt,
  type InsightsInput,
} from './prompts.js';

/**
 * Geração dos insights mensais do casal.
 *
 * O trabalho pesado é feito em SQL, não pelo modelo: agregamos, comparamos com
 * a média dos 3 meses anteriores e calculamos a situação de cada meta antes de
 * chamar a IA. O modelo recebe números prontos e só faz o que faz bem —
 * priorizar, explicar e traduzir em ação.
 *
 * Mandar o extrato cru e pedir "analise" produziria aritmética inventada, e
 * aritmética errada em app financeiro destrói a confiança do usuário de vez.
 */

export const insightsPayloadSchema = z.object({
  resumo: z.string(),
  saude_financeira: z.object({
    nota: z.number().min(0).max(10),
    justificativa: z.string(),
    taxa_poupanca_pct: z.number(),
    tendencia: z.enum(['melhorando', 'estavel', 'piorando']),
  }),
  destaques: z
    .array(
      z.object({
        tipo: z.enum(['alerta', 'conquista', 'observacao']),
        titulo: z.string(),
        descricao: z.string(),
        categoria: z.string().nullable(),
        impacto_reais: z.number(),
      }),
    )
    .max(4),
  recomendacoes: z
    .array(
      z.object({
        acao: z.string(),
        economia_mensal_estimada: z.number(),
        impacto_nas_metas: z.string(),
        dificuldade: z.enum(['facil', 'media', 'dificil']),
      }),
    )
    .max(3),
  metas: z.array(
    z.object({
      meta_id: z.string(),
      situacao: z.enum(['adiantada', 'no_ritmo', 'atrasada', 'parada']),
      comentario: z.string(),
    }),
  ),
  projecao_proximo_mes: z.object({
    despesa_estimada: z.number(),
    base: z.string(),
    compromissos_ja_assumidos: z.number(),
  }),
});

export type InsightsPayload = z.infer<typeof insightsPayloadSchema>;

export async function generateMonthlyInsights(input: {
  householdId: string;
  referenceMonth: string; // "2026-07"
  force?: boolean;
}): Promise<{ payload: InsightsPayload; cached: boolean }> {
  const month = parseMonth(input.referenceMonth);

  if (!input.force) {
    const cached = await prisma.aiInsight.findUnique({
      where: { householdId_referenceMonth: { householdId: input.householdId, referenceMonth: month } },
    });
    if (cached) {
      return { payload: cached.payload as InsightsPayload, cached: true };
    }
  }

  const data = await collectInsightsInput(input.householdId, month);

  if (data.income === 0 && data.expenses === 0) {
    throw badRequest('Não há movimentação registrada neste mês para analisar.');
  }
  if (!aiEnabled) {
    throw badRequest('A análise por IA está desabilitada nesta instalação.');
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: env.AI_MODEL,
    max_tokens: 3000,
    // Um pouco de temperatura: o texto precisa soar humano e variar entre os
    // meses. Os números já vêm prontos, então isso não afeta a exatidão.
    temperature: 0.4,
    system: [{ type: 'text', text: INSIGHTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: buildInsightsUserPrompt(data) },
      { role: 'assistant', content: '{' },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let payload: InsightsPayload;
  try {
    payload = insightsPayloadSchema.parse(JSON.parse(`{${text}`.replace(/```json|```/g, '').trim()));
  } catch (error) {
    logger.error({ error, preview: text.slice(0, 400) }, 'resposta de insights inválida');
    throw badRequest('Não foi possível gerar a análise deste mês. Tente novamente.');
  }

  await prisma.aiInsight.upsert({
    where: { householdId_referenceMonth: { householdId: input.householdId, referenceMonth: month } },
    create: {
      householdId: input.householdId,
      referenceMonth: month,
      payload,
      model: env.AI_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    update: {
      payload,
      model: env.AI_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      generatedAt: new Date(),
    },
  });

  return { payload, cached: false };
}

/**
 * Monta o dossiê do mês. Tudo em REAIS aqui (não centavos) e com despesa em
 * número positivo: é assim que o prompt espera, e converter na fronteira evita
 * que o modelo tenha que fazer conta de sinal — onde ele erraria.
 */
async function collectInsightsInput(householdId: string, month: Date): Promise<InsightsInput> {
  const start = month;
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const historyStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 3, 1));

  const [household, current, previous, history, top, goals, futureInstallments, openStatements] =
    await Promise.all([
      prisma.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { name: true, members: { select: { user: { select: { id: true, name: true } } } } },
      }),
      // Mês de referência, por categoria
      prisma.$queryRaw<Array<{ slug: string; name: string; total: bigint }>>`
        SELECT COALESCE(c.slug, 'outros.sem-categoria') AS slug,
               COALESCE(c.name, 'Sem categoria')        AS name,
               SUM(t.amount_cents)::bigint              AS total
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.household_id = ${householdId}::uuid
           AND t.competence_date >= ${start} AND t.competence_date < ${end}
           AND COALESCE(c.kind, 'expense') NOT IN ('transfer')
         GROUP BY 1, 2`,
      // Média dos 3 meses anteriores, por categoria
      prisma.$queryRaw<Array<{ slug: string; avg_total: number }>>`
        SELECT COALESCE(c.slug, 'outros.sem-categoria') AS slug,
               (SUM(t.amount_cents) / 3.0)              AS avg_total
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.household_id = ${householdId}::uuid
           AND t.competence_date >= ${historyStart} AND t.competence_date < ${start}
           AND COALESCE(c.kind, 'expense') NOT IN ('transfer')
         GROUP BY 1`,
      // Série mensal de entradas e saídas
      prisma.$queryRaw<Array<{ month: Date; income: bigint; expenses: bigint }>>`
        SELECT date_trunc('month', t.competence_date)::date AS month,
               SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0)::bigint AS income,
               SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0)::bigint AS expenses
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.household_id = ${householdId}::uuid
           AND t.competence_date >= ${historyStart} AND t.competence_date < ${end}
           AND COALESCE(c.kind, 'expense') <> 'transfer'
         GROUP BY 1 ORDER BY 1`,
      // Maiores saídas do mês
      prisma.transaction.findMany({
        where: {
          householdId,
          competenceDate: { gte: start, lt: end },
          amountCents: { lt: 0 },
        },
        orderBy: { amountCents: 'asc' },
        take: 12,
        select: {
          description: true,
          amountCents: true,
          postedAt: true,
          category: { select: { name: true } },
        },
      }),
      getGoalProgress(householdId),
      // Parcelas já lançadas que caem no mês seguinte
      prisma.transaction.aggregate({
        where: {
          householdId,
          competenceDate: {
            gte: end,
            lt: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 2, 1)),
          },
          amountCents: { lt: 0 },
        },
        _sum: { amountCents: true },
      }),
      prisma.cardStatement.aggregate({
        where: { householdId, status: { in: ['open', 'closed'] } },
        _sum: { totalAmountCents: true },
      }),
    ]);

  const toReais = (cents: bigint | number | null): number => Math.abs(Number(cents ?? 0)) / 100;

  const prevBySlug = new Map(previous.map((p) => [p.slug, Math.abs(Number(p.avg_total)) / 100]));

  const byCategory = current
    .filter((c) => Number(c.total) < 0) // só despesas no comparativo
    .map((c) => {
      const total = toReais(c.total);
      const previousAverage = prevBySlug.get(c.slug) ?? 0;
      return {
        slug: c.slug,
        name: c.name,
        total,
        previousAverage: Number(previousAverage.toFixed(2)),
        changePct:
          previousAverage > 0
            ? Number((((total - previousAverage) / previousAverage) * 100).toFixed(1))
            : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const income = current.reduce((sum, c) => sum + (Number(c.total) > 0 ? Number(c.total) : 0), 0) / 100;
  const expenses = byCategory.reduce((sum, c) => sum + c.total, 0);
  const balance = Number((income - expenses).toFixed(2));

  // Recorrentes: mesmo estabelecimento em pelo menos 3 dos 4 meses da janela.
  const recurring = await prisma.$queryRaw<
    Array<{ description: string; amount: number; category: string | null }>
  >`
    SELECT t.normalized_description AS description,
           (AVG(ABS(t.amount_cents)) / 100.0)::float AS amount,
           MAX(c.name) AS category
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.household_id = ${householdId}::uuid
       AND t.competence_date >= ${historyStart} AND t.competence_date < ${end}
       AND t.amount_cents < 0
     GROUP BY t.normalized_description
    HAVING COUNT(DISTINCT date_trunc('month', t.competence_date)) >= 3
     ORDER BY AVG(ABS(t.amount_cents)) DESC
     LIMIT 10`;

  return {
    household: {
      name: household.name,
      members: household.members.map((m) => ({ id: m.user.id, name: m.user.name })),
    },
    referenceMonth: month.toISOString().slice(0, 7),
    income: Number(income.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    balance,
    savingsRatePct: income > 0 ? Number((((income - expenses) / income) * 100).toFixed(1)) : 0,
    byCategory,
    historical: history.map((h) => ({
      month: h.month.toISOString().slice(0, 7),
      income: toReais(h.income),
      expenses: toReais(h.expenses),
    })),
    topTransactions: top.map((t) => ({
      description: t.description,
      amount: toReais(t.amountCents),
      category: t.category?.name ?? null,
      date: t.postedAt.toISOString().slice(0, 10),
    })),
    recurring: recurring.map((r) => ({
      description: r.description,
      amount: Number(r.amount.toFixed(2)),
      category: r.category,
    })),
    futureCommitments: {
      nextMonthInstallments: toReais(futureInstallments._sum.amountCents),
      openCardStatements: toReais(openStatements._sum.totalAmountCents),
    },
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmountCents / 100,
      currentAmount: g.currentAmountCents / 100,
      targetDate: g.targetDate,
      monthlyNeeded: g.requiredMonthlyCents / 100,
      contributedThisMonth: g.contributedThisMonthCents / 100,
    })),
  };
}

function parseMonth(value: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) throw badRequest('Mês inválido. Use o formato YYYY-MM.');
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) throw badRequest('Mês inválido.');
  return date;
}
