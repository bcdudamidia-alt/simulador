'use client';

import type {
  Account,
  AccountInput,
  Card,
  CardInput,
  Category,
  DashboardSummary,
  Goal,
  GoalInput,
  Household,
  ImportBatch,
  ImportResult,
  MonthlyInsights,
  TransactionFilters,
  TransactionInput,
  TransactionPage,
} from './types';

/**
 * Cliente HTTP da API.
 *
 * Duas decisões de segurança que ditam o formato deste arquivo:
 *
 *  1. O access token vive em MEMÓRIA (o módulo), nunca em localStorage. Um XSS
 *     em localStorage rouba a sessão inteira e ela sobrevive ao fechamento da
 *     aba; em memória, o estrago acaba com o reload.
 *  2. O refresh token é um cookie httpOnly que o navegador manda sozinho
 *     (`credentials: 'include'`). O JavaScript nunca o vê — nem o nosso.
 *
 * O 401 é tratado uma vez só: uma promise de refresh compartilhada evita que
 * dez requests simultâneas disparem dez rotações concorrentes (o que a detecção
 * de reuso do backend interpretaria, corretamente, como token roubado).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api/v1';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const isFormData = init.body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      // Não definimos Content-Type em FormData: o browser precisa gerar o
      // boundary do multipart, e defini-lo à mão quebra o upload.
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'X-Requested-With': 'XMLHttpRequest',
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string; details?: unknown } }
      | null;
    throw new ApiError(
      response.status,
      body?.error?.message ?? `Erro ${response.status}`,
      body?.error?.code,
      body?.error?.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function refreshSession(): Promise<boolean> {
  // Uma rotação por vez, compartilhada entre todas as chamadas em voo.
  refreshPromise ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    })
    .catch(() => {
      accessToken = null;
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export interface AuthPayload {
  accessToken: string;
  user: { id: string; name: string; email: string };
  household: { id: string; name: string; role: string };
}

export const api = {
  /** Refresh silencioso do boot: usa só o cookie httpOnly, sem Authorization. */
  refresh: async (): Promise<AuthPayload> => {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) throw new ApiError(response.status, 'Sem sessão ativa.');
    const data = (await response.json()) as AuthPayload;
    accessToken = data.accessToken;
    return data;
  },

  login: (email: string, password: string) =>
    request<AuthPayload>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((result) => {
      accessToken = result.accessToken;
      return result;
    }),

  register: (input: { name: string; email: string; password: string; householdName?: string }) =>
    request<AuthPayload>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((result) => {
      accessToken = result.accessToken;
      return result;
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  getDashboard: (month?: string) =>
    request<DashboardSummary>(`/dashboard${month ? `?month=${month}` : ''}`),

  getInsights: (month: string, force = false) =>
    request<{ payload: MonthlyInsights; cached: boolean }>(
      `/insights/${month}${force ? '?force=true' : ''}`,
    ),

  /** Upload de extrato. Um destino apenas: conta OU cartão. */
  importStatement: (file: File, destination: { accountId?: string; creditCardId?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (destination.accountId) form.append('accountId', destination.accountId);
    if (destination.creditCardId) form.append('creditCardId', destination.creditCardId);
    return request<ImportResult>('/imports', { method: 'POST', body: form });
  },

  recategorize: (transactionId: string, categoryId: string, applyToSimilar = true) =>
    request<{ rulesCreated: number; transactionsUpdated: number }>(
      `/transactions/${transactionId}/category`,
      { method: 'PATCH', body: JSON.stringify({ categoryId, applyToSimilar }) },
    ),


  getHousehold: () => request<Household>('/household'),

  getAccounts: () => request<{ data: Account[] }>('/accounts').then((r) => r.data),
  createAccount: (input: AccountInput) =>
    request<Account>('/accounts', { method: 'POST', body: JSON.stringify(input) }),
  updateAccount: (id: string, input: Partial<AccountInput>) =>
    request<Account>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteAccount: (id: string) =>
    request<{ deleted: boolean; archived: boolean; message?: string }>(`/accounts/${id}`, {
      method: 'DELETE',
    }),

  getCards: () => request<{ data: Card[] }>('/cards').then((r) => r.data),
  createCard: (input: CardInput) =>
    request<Card>('/cards', { method: 'POST', body: JSON.stringify(input) }),
  updateCard: (id: string, input: Partial<CardInput>) =>
    request<Card>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteCard: (id: string) =>
    request<{ deleted: boolean; archived: boolean; message?: string }>(`/cards/${id}`, {
      method: 'DELETE',
    }),

  getCategories: () => request<{ data: Category[] }>('/categories').then((r) => r.data),

  getTransactions: (filters: TransactionFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request<TransactionPage>(`/transactions${query ? `?${query}` : ''}`);
  },
  createTransaction: (input: TransactionInput) =>
    request<{ id: string }>('/transactions', { method: 'POST', body: JSON.stringify(input) }),

  getImports: () => request<{ data: ImportBatch[] }>('/imports').then((r) => r.data),
  deleteImport: (id: string) =>
    request<{ deleted: number; kept: number; message: string }>(`/imports/${id}`, {
      method: 'DELETE',
    }),

  getGoals: () => request<{ data: Goal[] }>('/goals').then((r) => r.data),
  createGoal: (input: GoalInput) =>
    request<Goal>('/goals', { method: 'POST', body: JSON.stringify(input) }),
  updateGoal: (id: string, input: Partial<GoalInput> & { status?: string }) =>
    request<Goal>(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteGoal: (id: string) => request<{ deleted: boolean }>(`/goals/${id}`, { method: 'DELETE' }),
  addContribution: (
    goalId: string,
    input: { amountCents: number; contributedAt?: string; note?: string; userId?: string },
  ) =>
    request<{ id: string; currentAmountCents: number }>(`/goals/${goalId}/contributions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  simulateGoal: (
    goalId: string,
    scenario: { monthlyContributionCents?: number; targetDate?: string },
  ) =>
    request<{
      scenario: 'by_amount' | 'by_date';
      requiredMonthlyCents: number;
      completionDate: string;
      monthsToComplete: number;
      totalToSaveCents: number;
      deltaVsCurrentPaceCents: number;
    }>(`/goals/${goalId}/simulate`, { method: 'POST', body: JSON.stringify(scenario) }),
};
