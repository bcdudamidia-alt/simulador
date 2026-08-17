'use client';

import { useCallback, useEffect, useState } from 'react';
import { AccountsPanel } from '../../components/dashboard/accounts-panel';
import { CashFlowChart } from '../../components/dashboard/cash-flow-chart';
import { CategoryBreakdown } from '../../components/dashboard/category-breakdown';
import { GoalsPanel } from '../../components/dashboard/goals-panel';
import { InsightsPanel } from '../../components/dashboard/insights-panel';
import { KpiRow } from '../../components/dashboard/kpi-row';
import { RecentTransactions } from '../../components/dashboard/recent-transactions';
import { api } from '../../lib/api';
import { DEMO_DASHBOARD } from '../../lib/demo-data';
import { formatMonthLong } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { DashboardSummary } from '../../lib/types';

/**
 * Dashboard — a tela principal do Pareo.
 *
 * Ordem de leitura, de cima para baixo:
 *   1. Quanto temos          (número herói: saldo consolidado)
 *   2. Como foi o mês        (entradas, saídas, projeção)
 *   3. Para onde foi         (categorias ordenadas)
 *   4. Como estamos indo     (fluxo de caixa, 6 meses)
 *   5. Onde queremos chegar  (metas do casal)
 *   6. O que fazer           (análise da IA)
 *
 * Cliente e não Server Component porque o access token vive em memória no
 * browser — o servidor Next não o tem, e passá-lo pelo servidor significaria
 * gravá-lo em cookie legível, que é justamente o que estamos evitando. Quando
 * houver BFF (v1.1), esta página vira RSC e o fetch sai daqui.
 */
export default function DashboardPage() {
  const { status } = useSession();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (reference: string, demo: boolean) => {
      // Em demonstração nem chegamos a chamar a API: sem sessão ela devolveria
      // 401 e o usuário veria um erro em vez de um produto.
      if (demo) {
        setData(DEMO_DASHBOARD);
        setState('ready');
        return;
      }

      setState('loading');
      try {
        setData(await api.getDashboard(reference));
        setState('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar o painel.');
        setState('error');
      }
    },
    [],
  );

  useEffect(() => {
    if (status === 'loading' || status === 'unauthenticated') return;
    void load(month, status === 'demo');
  }, [load, month, status]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
            Painel do casal
          </h1>
          <p className="text-sm text-ink-muted">{formatMonthLong(month)}</p>
        </div>

        <MonthPicker value={month} onChange={setMonth} />
      </header>

      {state === 'error' ? (
        <div className="rounded-xl border border-[var(--status-critical)] p-6">
          <p className="text-sm font-medium text-[var(--status-critical)]">{error}</p>
          <button
            type="button"
            onClick={() => void load(month, status === 'demo')}
            className="mt-3 rounded-md border border-[var(--hairline)] px-3 py-1.5 text-xs font-medium text-ink-secondary"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {state === 'loading' && !data ? <DashboardSkeleton /> : null}

      {data ? (
        <div className="space-y-4">
          <KpiRow data={data} />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <CashFlowChart data={data.cashFlow} />
              <CategoryBreakdown data={data.expensesByCategory} />
              <RecentTransactions
                transactions={data.recentTransactions}
                pendingReviewCount={data.pendingReviewCount}
              />
            </div>

            <div className="space-y-4">
              <AccountsPanel accounts={data.accounts} cards={data.cards} />
              <GoalsPanel goals={data.goals} />
              <InsightsPanel month={month} disabled={status === 'demo'} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const shift = (delta: number): void => {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1 + delta, 1));
    onChange(date.toISOString().slice(0, 7));
  };

  const isCurrentMonth = value >= new Date().toISOString().slice(0, 7);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[var(--hairline)] p-0.5">
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="Mês anterior"
        className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-[var(--gridline)] hover:text-ink-primary"
      >
        <span aria-hidden>◀</span>
      </button>
      <span className="px-2 text-xs font-medium tabular-nums text-ink-secondary">
        {value.split('-').reverse().join('/')}
      </span>
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={isCurrentMonth}
        aria-label="Próximo mês"
        className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-[var(--gridline)] hover:text-ink-primary disabled:opacity-30"
      >
        <span aria-hidden>▶</span>
      </button>
    </div>
  );
}

/** Esqueleto com a mesma geometria do conteúdo real — sem salto de layout. */
function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando painel">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-32 animate-pulse rounded-xl bg-surface lg:col-span-2" />
        <div className="h-32 animate-pulse rounded-xl bg-surface" />
        <div className="h-32 animate-pulse rounded-xl bg-surface" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-xl bg-surface lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-xl bg-surface" />
      </div>
    </div>
  );
}
