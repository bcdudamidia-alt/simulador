import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { SYSTEM_CATEGORIES } from '../src/modules/categories/system-categories.js';

/**
 * Seed de desenvolvimento.
 *
 * Cria um casal com contas, cartão, metas e ~3 meses de transações — o
 * suficiente para o dashboard, o comparativo mês a mês e os insights terem o
 * que mostrar sem depender de um arquivo OFX real.
 *
 * Idempotente: rodar duas vezes não duplica nada.
 *
 * Rodar:  npm run db:seed --workspace @pareo/api
 */
const prisma = new PrismaClient();

const DEMO_PASSWORD = 'pareo-dev-123456';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed não roda em produção.');
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const ana = await prisma.user.upsert({
    where: { email: 'ana@exemplo.com' },
    create: { email: 'ana@exemplo.com', name: 'Ana Ribeiro', passwordHash },
    update: {},
  });

  const bruno = await prisma.user.upsert({
    where: { email: 'bruno@exemplo.com' },
    create: { email: 'bruno@exemplo.com', name: 'Bruno Alves', passwordHash },
    update: {},
  });

  let household = await prisma.household.findFirst({ where: { name: 'Casa da Ana e do Bruno' } });
  household ??= await prisma.household.create({
    data: {
      name: 'Casa da Ana e do Bruno',
      members: {
        create: [
          { userId: ana.id, role: 'owner' },
          { userId: bruno.id, role: 'partner' },
        ],
      },
    },
  });

  // Cada household tem a sua própria cópia do catálogo de categorias.
  const existingCategories = await prisma.category.count({ where: { householdId: household.id } });
  if (existingCategories === 0) {
    await prisma.category.createMany({
      data: SYSTEM_CATEGORIES.map((c) => ({ ...c, householdId: household!.id, isSystem: true })),
    });
  }
  const categories = await prisma.category.findMany({ where: { householdId: household.id } });
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));

  // ── contas ──
  const conjunta = await upsertAccount(household.id, {
    name: 'Nubank — conjunta',
    type: 'checking',
    ownerUserId: null,
    color: '#2a78d6',
    balance: 1_284_500n,
  });
  await upsertAccount(household.id, {
    name: 'Itaú — Ana',
    type: 'checking',
    ownerUserId: ana.id,
    color: '#eb6834',
    balance: 742_180n,
  });
  await upsertAccount(household.id, {
    name: 'Reserva de emergência',
    type: 'investment',
    ownerUserId: null,
    color: '#4a3aa7',
    balance: 2_300_000n,
  });

  let card = await prisma.creditCard.findFirst({
    where: { householdId: household.id, name: 'Nubank Ultravioleta' },
  });
  card ??= await prisma.creditCard.create({
    data: {
      householdId: household.id,
      name: 'Nubank Ultravioleta',
      brand: 'mastercard',
      closingDay: 28,
      dueDay: 10,
      creditLimitCents: 1_200_000n,
      color: '#4a3aa7',
      paymentAccountId: conjunta.id,
    },
  });

  // ── transações dos últimos 3 meses ──
  const recurring: Array<[string, bigint, string]> = [
    ['ALUGUEL — IMOBILIARIA CENTRO', -320_000n, 'moradia.aluguel'],
    ['ENEL SP', -34_210n, 'moradia.energia'],
    ['SABESP', -12_400n, 'moradia.agua'],
    ['VIVO FIBRA', -14_990n, 'moradia.internet-telefone'],
    ['UNIMED', -64_800n, 'saude.plano'],
    ['NETFLIX.COM', -5_590n, 'lazer.streaming'],
    ['SPOTIFY', -3_490n, 'lazer.streaming'],
    ['ASSAI ATACADISTA', -214_800n, 'alimentacao.mercado'],
    ['SALARIO EMPRESA XYZ LTDA', 921_000n, 'receita.salario'],
    ['SALARIO CONSULTORIA ABC', 921_000n, 'receita.salario'],
  ];

  const now = new Date();
  const rows = [];

  for (let monthsAgo = 2; monthsAgo >= 0; monthsAgo--) {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 5));
    const monthStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));

    for (const [description, amount, slug] of recurring) {
      // Variação de ±8% para o comparativo mês a mês não ficar chapado.
      const jitter = amount > 0n ? 1 : 1 + (Math.random() - 0.5) * 0.16;
      const value = BigInt(Math.round(Number(amount) * jitter));

      rows.push({
        householdId: household.id,
        accountId: conjunta.id,
        postedAt: base,
        competenceDate: monthStart,
        amountCents: value,
        description,
        normalizedDescription: description.toUpperCase(),
        categoryId: bySlug.get(slug) ?? null,
        categorySource: 'rule' as const,
        categoryConfidence: 1,
        type: value < 0n ? ('expense' as const) : ('income' as const),
        dedupeHash: `seed-${monthsAgo}-${description}-${value}`,
        paidByUserId: monthsAgo % 2 === 0 ? ana.id : bruno.id,
      });
    }

    // Alguns gastos de cartão, incluindo um parcelamento
    for (let i = 0; i < 6; i++) {
      const day = 3 + i * 4;
      const value = BigInt(-(2000 + Math.round(Math.random() * 12000)));
      rows.push({
        householdId: household.id,
        creditCardId: card.id,
        postedAt: new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day)),
        competenceDate: monthStart,
        amountCents: value,
        description: `IFOOD *RESTAURANTE ${i + 1}`,
        normalizedDescription: `IFOOD RESTAURANTE ${i + 1}`,
        categoryId: bySlug.get('alimentacao.delivery') ?? null,
        categorySource: 'ai' as const,
        categoryConfidence: 0.93,
        type: 'expense' as const,
        dedupeHash: `seed-card-${monthsAgo}-${i}`,
        paidByUserId: bruno.id,
      });
    }
  }

  await prisma.transaction.createMany({ data: rows, skipDuplicates: true });

  // ── metas ──
  const existingGoals = await prisma.goal.count({ where: { householdId: household.id } });
  if (existingGoals === 0) {
    const apartamento = await prisma.goal.create({
      data: {
        householdId: household.id,
        createdByUserId: ana.id,
        name: 'Entrada do apartamento',
        kind: 'property',
        targetAmountCents: 12_000_000n,
        initialAmountCents: 1_500_000n,
        targetDate: new Date(Date.UTC(now.getUTCFullYear() + 2, 5, 1)),
        priority: 1,
        color: '#2a78d6',
      },
    });

    await prisma.goalContribution.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        householdId: household!.id,
        goalId: apartamento.id,
        userId: i % 2 === 0 ? ana.id : bruno.id,
        amountCents: BigInt(150_000 + Math.round(Math.random() * 100_000)),
        contributedAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 9 + i, 10)),
      })),
    });

    await prisma.goal.create({
      data: {
        householdId: household.id,
        createdByUserId: bruno.id,
        name: 'Casamento',
        kind: 'wedding',
        targetAmountCents: 4_500_000n,
        initialAmountCents: 3_780_000n,
        targetDate: new Date(Date.UTC(now.getUTCFullYear() + 1, 3, 1)),
        priority: 2,
        color: '#e87ba4',
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`
✓ Seed concluído.

  Household: ${household.name}
  Login:     ana@exemplo.com  |  bruno@exemplo.com
  Senha:     ${DEMO_PASSWORD}
`);
}

async function upsertAccount(
  householdId: string,
  input: {
    name: string;
    type: 'checking' | 'savings' | 'investment' | 'cash' | 'other';
    ownerUserId: string | null;
    color: string;
    balance: bigint;
  },
) {
  const existing = await prisma.account.findFirst({ where: { householdId, name: input.name } });
  if (existing) return existing;

  return prisma.account.create({
    data: {
      householdId,
      name: input.name,
      type: input.type,
      ownerUserId: input.ownerUserId,
      color: input.color,
      currentBalanceCents: input.balance,
      balanceSyncedAt: new Date(),
    },
  });
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
