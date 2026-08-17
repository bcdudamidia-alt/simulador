import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { aiEnabled, env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { toDisplayName } from '../imports/normalize.js';
import { CATEGORIZATION_SYSTEM_PROMPT, buildCategorizationUserPrompt } from './prompts.js';

/**
 * Pipeline de categorização em três níveis, do barato para o caro:
 *
 *   [1] regra explícita do household   — grátis, determinística, prioridade máxima
 *   [2] histórico do merchant          — grátis, aprende com o próprio uso
 *   [3] LLM em lote                    — pago, só para o que sobrou
 *
 * A ordem não é otimização prematura: em regime, a maior parte do extrato de um
 * casal é recorrente (mercado, aluguel, streaming, posto). Depois de um ou dois
 * meses, o nível [3] passa a ver quase só transação nova de verdade — o que
 * derruba o custo por importação de reais para centavos.
 */

const LLM_BATCH_SIZE = 40;
const REVIEW_THRESHOLD = 0.7;

const aiResponseSchema = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    confidence: z.number().min(0).max(1),
    merchant: z.string().nullable().optional(),
  }),
);

export interface CategorizeResult {
  total: number;
  byRule: number;
  byHistory: number;
  byAi: number;
  uncategorized: number;
  needsReview: number;
}

export async function categorizeBatch(input: {
  householdId: string;
  importBatchId?: string;
  transactionIds?: string[];
}): Promise<CategorizeResult> {
  const { householdId } = input;

  const pending = await prisma.transaction.findMany({
    where: {
      householdId,
      categoryId: null,
      ...(input.importBatchId ? { importBatchId: input.importBatchId } : {}),
      ...(input.transactionIds ? { id: { in: input.transactionIds } } : {}),
    },
    select: {
      id: true,
      description: true,
      normalizedDescription: true,
      amountCents: true,
      postedAt: true,
    },
  });

  const result: CategorizeResult = {
    total: pending.length,
    byRule: 0,
    byHistory: 0,
    byAi: 0,
    uncategorized: 0,
    needsReview: 0,
  };
  if (pending.length === 0) return result;

  // Carregamos regras, merchants e categorias uma vez só. Consultar por
  // transação transformaria uma importação de 500 linhas em 1.500 queries.
  const [rules, merchants, categories] = await Promise.all([
    prisma.categorizationRule.findMany({
      where: { householdId },
      orderBy: { priority: 'asc' },
      select: { id: true, matchType: true, pattern: true, categoryId: true },
    }),
    prisma.merchant.findMany({
      where: { householdId, defaultCategoryId: { not: null }, seenCount: { gte: 3 } },
      select: { id: true, normalizedName: true, defaultCategoryId: true },
    }),
    prisma.category.findMany({
      where: { householdId },
      select: { id: true, slug: true, name: true, kind: true },
    }),
  ]);

  const merchantByName = new Map(merchants.map((m) => [m.normalizedName, m]));
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  type Decision = {
    id: string;
    categoryId: string;
    source: 'rule' | 'history' | 'ai';
    confidence: number;
    merchantId?: string;
  };
  const decisions: Decision[] = [];
  const leftovers: typeof pending = [];
  const ruleHits = new Map<string, number>();

  // ── [1] regras e [2] histórico ──
  for (const tx of pending) {
    const rule = rules.find((r) => matches(r.matchType, r.pattern, tx.normalizedDescription));
    if (rule) {
      decisions.push({ id: tx.id, categoryId: rule.categoryId, source: 'rule', confidence: 1 });
      ruleHits.set(rule.id, (ruleHits.get(rule.id) ?? 0) + 1);
      result.byRule++;
      continue;
    }

    const merchant = merchantByName.get(tx.normalizedDescription);
    if (merchant?.defaultCategoryId) {
      decisions.push({
        id: tx.id,
        categoryId: merchant.defaultCategoryId,
        source: 'history',
        confidence: 0.9,
        merchantId: merchant.id,
      });
      result.byHistory++;
      continue;
    }

    leftovers.push(tx);
  }

  // ── [3] LLM ──
  if (leftovers.length > 0 && aiEnabled) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
    const catalog = categories.map((c) => ({ slug: c.slug, name: c.name, kind: c.kind }));

    for (let i = 0; i < leftovers.length; i += LLM_BATCH_SIZE) {
      const chunk = leftovers.slice(i, i + LLM_BATCH_SIZE);
      try {
        const classified = await classifyWithLlm(client, catalog, chunk);

        for (const item of classified) {
          const category = categoryBySlug.get(item.slug);
          if (!category) {
            // O prompt proíbe inventar slug, mas confiar nisso seria ingênuo:
            // slug inválido vira "sem categoria", não vira erro de FK.
            logger.warn({ slug: item.slug }, 'LLM devolveu slug desconhecido');
            continue;
          }

          let merchantId: string | undefined;
          if (item.merchant) {
            const tx = chunk.find((t) => t.id === item.id);
            if (tx) {
              const merchant = await prisma.merchant.upsert({
                where: {
                  householdId_normalizedName: {
                    householdId,
                    normalizedName: tx.normalizedDescription,
                  },
                },
                create: {
                  householdId,
                  normalizedName: tx.normalizedDescription,
                  displayName: item.merchant.slice(0, 120),
                  defaultCategoryId: category.id,
                  seenCount: 1,
                },
                update: { seenCount: { increment: 1 } },
                select: { id: true },
              });
              merchantId = merchant.id;
            }
          }

          decisions.push({
            id: item.id,
            categoryId: category.id,
            source: 'ai',
            confidence: item.confidence,
            ...(merchantId ? { merchantId } : {}),
          });
          result.byAi++;
        }
      } catch (error) {
        // Um lote que falha não pode derrubar a importação inteira: as
        // transações desse lote ficam sem categoria e entram na fila de revisão.
        logger.error({ error, chunkSize: chunk.length }, 'lote de categorização por IA falhou');
      }
    }
  }

  // ── persistência ──
  await prisma.$transaction([
    ...decisions.map((d) =>
      prisma.transaction.update({
        where: { id: d.id },
        data: {
          categoryId: d.categoryId,
          categorySource: d.source,
          categoryConfidence: d.confidence,
          needsReview: d.confidence < REVIEW_THRESHOLD,
          ...(d.merchantId ? { merchantId: d.merchantId } : {}),
        },
      }),
    ),
    ...[...ruleHits].map(([ruleId, hits]) =>
      prisma.categorizationRule.update({
        where: { id: ruleId },
        data: { hitCount: { increment: hits } },
      }),
    ),
  ]);

  const decided = new Set(decisions.map((d) => d.id));
  const undecided = pending.filter((t) => !decided.has(t.id)).map((t) => t.id);
  if (undecided.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: undecided } },
      data: { needsReview: true },
    });
  }

  result.uncategorized = undecided.length;
  result.needsReview =
    undecided.length + decisions.filter((d) => d.confidence < REVIEW_THRESHOLD).length;

  logger.info({ householdId, ...result }, 'categorização concluída');
  return result;
}

async function classifyWithLlm(
  client: Anthropic,
  categories: Array<{ slug: string; name: string; kind: string }>,
  transactions: Array<{
    id: string;
    description: string;
    amountCents: bigint;
    postedAt: Date;
  }>,
): Promise<z.infer<typeof aiResponseSchema>> {
  const response = await client.messages.create({
    model: env.AI_MODEL,
    max_tokens: 4096,
    temperature: 0, // classificação precisa ser reproduzível
    system: [
      {
        type: 'text',
        text: CATEGORIZATION_SYSTEM_PROMPT,
        // O system prompt e o catálogo de categorias são idênticos em todos os
        // lotes; o cache derruba o custo de entrada em ~90% a partir do 2º lote.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildCategorizationUserPrompt({
          categories,
          transactions: transactions.map((t) => ({
            id: t.id,
            description: t.description,
            amountCents: Number(t.amountCents),
            postedAt: t.postedAt.toISOString().slice(0, 10),
          })),
        }),
      },
      // Prefill: força a resposta a começar já dentro do array JSON, o que
      // elimina o "Claro! Aqui está o JSON:" que quebraria o parse.
      { role: 'assistant', content: '[' },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const parsed: unknown = JSON.parse(`[${text}`.replace(/```json|```/g, '').trim());
  return aiResponseSchema.parse(parsed);
}

function matches(matchType: string, pattern: string, text: string): boolean {
  const p = pattern.toUpperCase();
  switch (matchType) {
    case 'equals':
      return text === p;
    case 'starts_with':
      return text.startsWith(p);
    case 'regex':
      try {
        // Regex vinda do usuário. Limitamos o tamanho porque um padrão com
        // backtracking catastrófico travaria o event loop inteiro.
        if (pattern.length > 200) return false;
        return new RegExp(pattern, 'i').test(text);
      } catch {
        return false;
      }
    case 'contains':
    default:
      return text.includes(p);
  }
}

/**
 * Quando o usuário corrige a categoria de uma transação, o sistema aprende:
 * cria (ou atualiza) a regra e o merchant, e reaplica às transações irmãs
 * ainda não revisadas.
 *
 * É o que fecha o ciclo — sem isto, o mesmo estabelecimento voltaria ao LLM
 * todo mês e o usuário corrigiria a mesma coisa para sempre.
 */
export async function learnFromCorrection(input: {
  householdId: string;
  transactionId: string;
  categoryId: string;
  applyToSimilar: boolean;
}): Promise<{ rulesCreated: number; transactionsUpdated: number }> {
  const tx = await prisma.transaction.findFirst({
    where: { id: input.transactionId, householdId: input.householdId },
    select: { normalizedDescription: true },
  });
  if (!tx) return { rulesCreated: 0, transactionsUpdated: 0 };

  await prisma.transaction.update({
    where: { id: input.transactionId },
    data: {
      categoryId: input.categoryId,
      categorySource: 'user',
      categoryConfidence: 1,
      needsReview: false,
    },
  });

  if (!input.applyToSimilar) return { rulesCreated: 0, transactionsUpdated: 1 };

  await prisma.merchant.upsert({
    where: {
      householdId_normalizedName: {
        householdId: input.householdId,
        normalizedName: tx.normalizedDescription,
      },
    },
    create: {
      householdId: input.householdId,
      normalizedName: tx.normalizedDescription,
      displayName: toDisplayName(tx.normalizedDescription),
      defaultCategoryId: input.categoryId,
      seenCount: 3, // já nasce confiável: veio de uma correção humana explícita
    },
    update: { defaultCategoryId: input.categoryId },
  });

  const existingRule = await prisma.categorizationRule.findFirst({
    where: {
      householdId: input.householdId,
      matchType: 'equals',
      pattern: tx.normalizedDescription,
    },
  });

  let rulesCreated = 0;
  if (existingRule) {
    await prisma.categorizationRule.update({
      where: { id: existingRule.id },
      data: { categoryId: input.categoryId },
    });
  } else {
    await prisma.categorizationRule.create({
      data: {
        householdId: input.householdId,
        matchType: 'equals',
        pattern: tx.normalizedDescription,
        categoryId: input.categoryId,
        priority: 50, // acima da regra manual padrão (100)
        autoCreated: true,
      },
    });
    rulesCreated = 1;
  }

  // Reaplica só ao que o usuário ainda não confirmou: sobrescrever uma escolha
  // manual anterior seria desfazer trabalho dele.
  const updated = await prisma.transaction.updateMany({
    where: {
      householdId: input.householdId,
      normalizedDescription: tx.normalizedDescription,
      categorySource: { in: ['ai', 'history'] },
    },
    data: {
      categoryId: input.categoryId,
      categorySource: 'rule',
      categoryConfidence: 1,
      needsReview: false,
    },
  });

  return { rulesCreated, transactionsUpdated: updated.count + 1 };
}
