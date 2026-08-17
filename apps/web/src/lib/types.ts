/**
 * DTOs da API.
 *
 * Espelham `apps/api/src/modules/*` à mão hoje. Na v1.1 estes tipos passam a
 * ser gerados a partir do OpenAPI do backend (ou movidos para um pacote
 * `@pareo/contracts` no workspace) — duplicação manual de contrato é dívida
 * conhecida, e está registrada como tal em vez de escondida.
 *
 * Todo campo terminado em `Cents` é INTEIRO em centavos.
 */

export interface DashboardSummary {
  referenceMonth: string;
  totals: {
    consolidatedBalanceCents: number;
    monthIncomeCents: number;
    monthExpensesCents: number;
    monthBalanceCents: number;
    savingsRatePct: number;
    openCardTotalCents: number;
    futureCommitmentsCents: number;
  };
  comparison: { incomeChangePct: number; expenseChangePct: number };
  accounts: AccountSummary[];
  cards: CardSummary[];
  expensesByCategory: CategorySlice[];
  cashFlow: CashFlowPoint[];
  projection: {
    realizedCents: number;
    projectedTotalCents: number;
    dayOfMonth: number;
    daysInMonth: number;
  };
  goals: GoalProgress[];
  pendingReviewCount: number;
  recentTransactions: RecentTransaction[];
}

export interface AccountSummary {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'investment' | 'cash' | 'other';
  color: string;
  balanceCents: number;
  ownerName: string | null;
  isShared: boolean;
}

export interface CardSummary {
  id: string;
  name: string;
  brand: string;
  color: string;
  currentStatementCents: number;
  limitCents: number | null;
  usagePct: number | null;
  dueDate: string | null;
  status: 'open' | 'closed' | 'paid' | 'overdue';
}

export interface CategorySlice {
  slug: string;
  name: string;
  color: string;
  totalCents: number;
  sharePct: number;
  previousTotalCents: number;
}

export interface CashFlowPoint {
  month: string;
  incomeCents: number;
  expensesCents: number;
  balanceCents: number;
}

export interface GoalProgress {
  id: string;
  name: string;
  kind: string;
  color: string;
  icon: string;
  status: string;
  targetAmountCents: number;
  currentAmountCents: number;
  progressPct: number;
  targetDate: string | null;
  monthsRemaining: number | null;
  requiredMonthlyCents: number;
  averageMonthlyCents: number;
  contributedThisMonthCents: number;
  projectedCompletion: string | null;
  pace: 'ahead' | 'on_track' | 'behind' | 'stalled' | 'achieved';
  byMember: Array<{ userId: string; name: string; amountCents: number; sharePct: number }>;
}

export interface RecentTransaction {
  id: string;
  description: string;
  amountCents: number;
  postedAt: string;
  categoryName: string | null;
  categoryColor: string | null;
  origin: string;
  needsReview: boolean;
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

export interface MonthlyInsights {
  resumo: string;
  saude_financeira: {
    nota: number;
    justificativa: string;
    taxa_poupanca_pct: number;
    tendencia: 'melhorando' | 'estavel' | 'piorando';
  };
  destaques: Array<{
    tipo: 'alerta' | 'conquista' | 'observacao';
    titulo: string;
    descricao: string;
    categoria: string | null;
    impacto_reais: number;
  }>;
  recomendacoes: Array<{
    acao: string;
    economia_mensal_estimada: number;
    impacto_nas_metas: string;
    dificuldade: 'facil' | 'media' | 'dificil';
  }>;
  metas: Array<{
    meta_id: string;
    situacao: 'adiantada' | 'no_ritmo' | 'atrasada' | 'parada';
    comentario: string;
  }>;
  projecao_proximo_mes: {
    despesa_estimada: number;
    base: string;
    compromissos_ja_assumidos: number;
  };
}
