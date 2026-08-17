import type { DashboardSummary } from './types';

/**
 * Dados de demonstração.
 *
 * Servem para (a) rodar o frontend sem backend durante o desenvolvimento e
 * (b) mostrar o produto funcionando quando a sessão expira, em vez de uma tela
 * vazia. São explicitamente rotulados como fictícios na UI — dado inventado que
 * se passa por real é a pior coisa que um app financeiro pode fazer.
 *
 * Todos os valores em CENTAVOS.
 */
export const DEMO_DASHBOARD: DashboardSummary = {
  referenceMonth: '2026-08',
  totals: {
    consolidatedBalanceCents: 4_782_340,
    monthIncomeCents: 1_842_000,
    monthExpensesCents: 1_237_480,
    monthBalanceCents: 604_520,
    savingsRatePct: 32.8,
    openCardTotalCents: 486_290,
    futureCommitmentsCents: 312_400,
  },
  comparison: { incomeChangePct: 4.2, expenseChangePct: 11.7 },

  accounts: [
    {
      id: 'a1',
      name: 'Nubank — conjunta',
      type: 'checking',
      color: '#2a78d6',
      balanceCents: 1_284_500,
      ownerName: null,
      isShared: true,
    },
    {
      id: 'a2',
      name: 'Itaú — Ana',
      type: 'checking',
      color: '#eb6834',
      balanceCents: 742_180,
      ownerName: 'Ana',
      isShared: false,
    },
    {
      id: 'a3',
      name: 'Inter — Bruno',
      type: 'checking',
      color: '#1baf7a',
      balanceCents: 455_660,
      ownerName: 'Bruno',
      isShared: false,
    },
    {
      id: 'a4',
      name: 'Reserva (CDB)',
      type: 'investment',
      color: '#4a3aa7',
      balanceCents: 2_300_000,
      ownerName: null,
      isShared: true,
    },
  ],

  cards: [
    {
      id: 'c1',
      name: 'Nubank Ultravioleta',
      brand: 'mastercard',
      color: '#4a3aa7',
      currentStatementCents: 318_940,
      limitCents: 1_200_000,
      usagePct: 26.6,
      dueDate: '2026-09-10',
      status: 'open',
    },
    {
      id: 'c2',
      name: 'Inter Black — Bruno',
      brand: 'visa',
      color: '#eda100',
      currentStatementCents: 167_350,
      limitCents: 800_000,
      usagePct: 20.9,
      dueDate: '2026-09-05',
      status: 'closed',
    },
  ],

  expensesByCategory: [
    { slug: 'moradia.aluguel', name: 'Aluguel', color: '#F97316', totalCents: 320_000, sharePct: 25.9, previousTotalCents: 320_000 },
    { slug: 'alimentacao.mercado', name: 'Supermercado', color: '#22C55E', totalCents: 214_800, sharePct: 17.4, previousTotalCents: 198_400 },
    { slug: 'alimentacao.delivery', name: 'Delivery', color: '#15803D', totalCents: 78_050, sharePct: 6.3, previousTotalCents: 41_200 },
    { slug: 'transporte.combustivel', name: 'Combustível', color: '#0EA5E9', totalCents: 68_400, sharePct: 5.5, previousTotalCents: 71_900 },
    { slug: 'saude.plano', name: 'Plano de saúde', color: '#EF4444', totalCents: 64_800, sharePct: 5.2, previousTotalCents: 64_800 },
    { slug: 'lazer.streaming', name: 'Streaming e assinaturas', color: '#7C3AED', totalCents: 18_970, sharePct: 1.5, previousTotalCents: 15_480 },
    { slug: 'moradia.energia', name: 'Energia elétrica', color: '#FBBF24', totalCents: 34_210, sharePct: 2.8, previousTotalCents: 28_900 },
    { slug: 'pessoal.vestuario', name: 'Roupas e calçados', color: '#EC4899', totalCents: 29_500, sharePct: 2.4, previousTotalCents: 12_300 },
    { slug: 'lazer.entretenimento', name: 'Cinema, shows e bares', color: '#6366F1', totalCents: 24_750, sharePct: 2.0, previousTotalCents: 31_600 },
    { slug: 'outros.nao-identificado', name: 'Não identificado', color: '#94A3B8', totalCents: 384_000, sharePct: 31.0, previousTotalCents: 290_000 },
  ],

  cashFlow: [
    { month: '2026-03', incomeCents: 1_760_000, expensesCents: 1_182_300, balanceCents: 577_700 },
    { month: '2026-04', incomeCents: 1_760_000, expensesCents: 1_341_900, balanceCents: 418_100 },
    { month: '2026-05', incomeCents: 1_812_000, expensesCents: 1_098_700, balanceCents: 713_300 },
    { month: '2026-06', incomeCents: 1_768_000, expensesCents: 1_205_400, balanceCents: 562_600 },
    { month: '2026-07', incomeCents: 1_767_500, expensesCents: 1_107_800, balanceCents: 659_700 },
    { month: '2026-08', incomeCents: 1_842_000, expensesCents: 1_237_480, balanceCents: 604_520 },
  ],

  projection: {
    realizedCents: 1_237_480,
    projectedTotalCents: 1_398_600,
    dayOfMonth: 17,
    daysInMonth: 31,
  },

  goals: [
    {
      id: 'g1',
      name: 'Entrada do apartamento',
      kind: 'property',
      color: '#2a78d6',
      icon: 'home',
      status: 'active',
      targetAmountCents: 12_000_000,
      currentAmountCents: 4_620_000,
      progressPct: 38.5,
      targetDate: '2028-06-01',
      monthsRemaining: 22,
      requiredMonthlyCents: 335_454,
      averageMonthlyCents: 298_000,
      contributedThisMonthCents: 310_000,
      projectedCompletion: '2028-10-01',
      pace: 'on_track',
      byMember: [
        { userId: 'u1', name: 'Ana', amountCents: 2_540_000, sharePct: 55 },
        { userId: 'u2', name: 'Bruno', amountCents: 2_080_000, sharePct: 45 },
      ],
    },
    {
      id: 'g2',
      name: 'Casamento',
      kind: 'wedding',
      color: '#e87ba4',
      icon: 'heart',
      status: 'active',
      targetAmountCents: 4_500_000,
      currentAmountCents: 3_780_000,
      progressPct: 84,
      targetDate: '2027-04-01',
      monthsRemaining: 8,
      requiredMonthlyCents: 90_000,
      averageMonthlyCents: 125_000,
      contributedThisMonthCents: 120_000,
      projectedCompletion: '2027-02-01',
      pace: 'ahead',
      byMember: [
        { userId: 'u1', name: 'Ana', amountCents: 1_890_000, sharePct: 50 },
        { userId: 'u2', name: 'Bruno', amountCents: 1_890_000, sharePct: 50 },
      ],
    },
    {
      id: 'g3',
      name: 'Viagem — Japão',
      kind: 'travel',
      color: '#1baf7a',
      icon: 'plane',
      status: 'active',
      targetAmountCents: 3_200_000,
      currentAmountCents: 420_000,
      progressPct: 13.1,
      targetDate: '2027-10-01',
      monthsRemaining: 14,
      requiredMonthlyCents: 198_571,
      averageMonthlyCents: 60_000,
      contributedThisMonthCents: 0,
      projectedCompletion: '2030-06-01',
      pace: 'behind',
      byMember: [{ userId: 'u2', name: 'Bruno', amountCents: 420_000, sharePct: 100 }],
    },
  ],

  pendingReviewCount: 7,

  recentTransactions: [
    { id: 't1', description: 'IFOOD *RESTAURANTE SAKURA', amountCents: -8_790, postedAt: '2026-08-16', categoryName: 'Delivery', categoryColor: '#15803D', origin: 'Nubank Ultravioleta', needsReview: false },
    { id: 't2', description: 'ASSAI ATACADISTA', amountCents: -47_320, postedAt: '2026-08-15', categoryName: 'Supermercado', categoryColor: '#22C55E', origin: 'Nubank — conjunta', needsReview: false },
    { id: 't3', description: 'PIX RECEBIDO — REEMBOLSO VIAGEM', amountCents: 62_000, postedAt: '2026-08-14', categoryName: 'Reembolso', categoryColor: '#34D399', origin: 'Itaú — Ana', needsReview: false },
    { id: 't4', description: 'PAG*ESTUDIO MOVIMENTO 08/12', amountCents: -18_900, postedAt: '2026-08-13', categoryName: null, categoryColor: null, origin: 'Inter Black — Bruno', needsReview: true },
    { id: 't5', description: 'ENEL SP', amountCents: -34_210, postedAt: '2026-08-12', categoryName: 'Energia elétrica', categoryColor: '#FBBF24', origin: 'Nubank — conjunta', needsReview: false },
    { id: 't6', description: 'SALARIO EMPRESA XYZ LTDA', amountCents: 921_000, postedAt: '2026-08-05', categoryName: 'Salário', categoryColor: '#10B981', origin: 'Itaú — Ana', needsReview: false },
    { id: 't7', description: 'ALUGUEL — IMOBILIARIA CENTRO', amountCents: -320_000, postedAt: '2026-08-05', categoryName: 'Aluguel', categoryColor: '#F97316', origin: 'Nubank — conjunta', needsReview: false },
    { id: 't8', description: '99*99POP VIAGEM', amountCents: -2_340, postedAt: '2026-08-04', categoryName: 'Uber e 99', categoryColor: '#0284C7', origin: 'Nubank Ultravioleta', needsReview: false },
  ],
};
