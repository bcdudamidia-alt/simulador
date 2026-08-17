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

// ─────────────────────── household, contas e cartões ───────────────────────

export interface Household {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  members: Array<{
    role: 'owner' | 'partner' | 'viewer';
    joinedAt: string;
    user: { id: string; name: string; email: string; avatarUrl: string | null };
  }>;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'investment' | 'cash' | 'other';
  color: string;
  icon: string;
  institutionCode: string | null;
  institutionName: string | null;
  currentBalanceCents: number;
  balanceSyncedAt: string | null;
  ownerUserId: string | null;
  isArchived: boolean;
  /** Só os 4 últimos dígitos — o número completo nunca sai da API. */
  numberMasked: string | null;
  owner: { id: string; name: string } | null;
}

export interface AccountInput {
  name: string;
  type: Account['type'];
  ownerUserId: string | null;
  institutionName?: string;
  accountNumber?: string;
  currentBalanceCents?: number;
  color?: string;
  icon?: string;
}

export interface Card {
  id: string;
  name: string;
  brand: 'visa' | 'mastercard' | 'elo' | 'amex' | 'hipercard' | 'other';
  color: string;
  creditLimitCents: number | null;
  closingDay: number;
  dueDay: number;
  ownerUserId: string | null;
  paymentAccountId: string | null;
  isArchived: boolean;
  last4: string | null;
  owner: { id: string; name: string } | null;
  paymentAccount: { id: string; name: string } | null;
  statements: Array<{
    id: string;
    referenceMonth: string;
    dueDate: string;
    totalAmountCents: number;
    status: 'open' | 'closed' | 'paid' | 'overdue';
  }>;
}

export interface CardInput {
  name: string;
  brand: Card['brand'];
  ownerUserId: string | null;
  paymentAccountId: string | null;
  last4?: string;
  holderName?: string;
  creditLimitCents: number | null;
  closingDay: number;
  dueDay: number;
  color?: string;
}

// ─────────────────────────── categorias e extrato ───────────────────────────

export interface Category {
  id: string;
  name: string;
  slug: string;
  kind: 'expense' | 'income' | 'transfer' | 'investment';
  color: string;
  icon: string;
}

export interface Transaction {
  id: string;
  description: string;
  amountCents: number;
  postedAt: string;
  competenceDate: string;
  type: 'expense' | 'income' | 'transfer' | 'refund';
  sharing: 'shared' | 'personal';
  needsReview: boolean;
  categorySource: 'rule' | 'history' | 'ai' | 'user' | null;
  categoryConfidence: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  category: Category | null;
  account: { id: string; name: string; color: string } | null;
  creditCard: { id: string; name: string; color: string } | null;
  paidBy: { id: string; name: string } | null;
}

export interface TransactionPage {
  data: Transaction[];
  pagination: { hasMore: boolean; nextCursor: string | null };
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  creditCardId?: string;
  needsReview?: 'true' | 'false';
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface TransactionInput {
  accountId?: string;
  creditCardId?: string;
  categoryId?: string;
  amountCents: number;
  description: string;
  postedAt: string;
  notes?: string;
  sharing?: 'shared' | 'personal';
  paidByUserId?: string;
}

// ──────────────────────────── importações e metas ────────────────────────────

export interface ImportBatch {
  id: string;
  filename: string;
  format: 'ofx' | 'csv' | 'manual';
  status: 'processing' | 'completed' | 'failed' | 'partial';
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  statementStart: string | null;
  statementEnd: string | null;
  createdAt: string;
  account: { id: string; name: string } | null;
  creditCard: { id: string; name: string } | null;
  createdBy: { name: string };
}

export type Goal = GoalProgress;

export interface GoalInput {
  name: string;
  description?: string;
  kind: 'wedding' | 'property' | 'travel' | 'emergency_fund' | 'vehicle' | 'education' | 'other';
  targetAmountCents: number;
  initialAmountCents?: number;
  targetDate?: string;
  monthlyTargetCents?: number;
  priority?: number;
  color?: string;
  icon?: string;
}
