import { Card } from '../ui/card';
import { formatCents, formatPct } from '../../lib/format';
import type { DashboardSummary } from '../../lib/types';

/**
 * Faixa de KPIs.
 *
 * O saldo consolidado é o número herói do produto: é a resposta para "quanto
 * temos", que é a pergunta que faz alguém abrir o app. Ele é o único ≥ 48px na
 * tela — mais de um número herói significa nenhum.
 *
 * Os outros três são stat tiles: rótulo, valor, delta contra o mês anterior.
 * Delta sempre nomeia o período comparado; "+12%" sem "vs. mês anterior" não
 * informa nada.
 */
export function KpiRow({ data }: { data: DashboardSummary }) {
  const { totals, comparison } = data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="lg:col-span-2">
        <p className="text-xs font-medium text-ink-muted">Saldo consolidado</p>
        <p className="mt-1 text-5xl font-semibold tracking-tight text-ink-primary">
          {formatCents(totals.consolidatedBalanceCents)}
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          Soma de {data.accounts.length} conta{data.accounts.length === 1 ? '' : 's'} ·{' '}
          <span className="text-[var(--value-down)]">
            {formatCents(totals.openCardTotalCents)}
          </span>{' '}
          em faturas abertas
        </p>
      </Card>

      <StatTile
        label="Entradas do mês"
        valueCents={totals.monthIncomeCents}
        deltaPct={comparison.incomeChangePct}
        upIsGood
      />

      <StatTile
        label="Saídas do mês"
        valueCents={totals.monthExpensesCents}
        deltaPct={comparison.expenseChangePct}
        upIsGood={false}
        footer={
          <>
            Projeção do mês:{' '}
            <strong className="font-medium text-ink-secondary">
              {formatCents(data.projection.projectedTotalCents)}
            </strong>{' '}
            <span className="text-ink-muted">(estimativa)</span>
          </>
        }
      />
    </div>
  );
}

function StatTile({
  label,
  valueCents,
  deltaPct,
  upIsGood,
  footer,
}: {
  label: string;
  valueCents: number;
  deltaPct: number;
  upIsGood: boolean;
  footer?: React.ReactNode;
}) {
  // A cor do delta é direção × se subir é bom. Gastar 20% a mais e gastar 20%
  // a menos não podem ser a mesma cor só porque os dois são "variação".
  const isPositiveDirection = deltaPct > 0;
  const isGood = isPositiveDirection === upIsGood;
  const tone =
    deltaPct === 0
      ? 'text-ink-muted'
      : isGood
        ? 'text-[var(--value-up)]'
        : 'text-[var(--value-down)]';

  return (
    <Card>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary">
        {formatCents(valueCents)}
      </p>
      <p className={`mt-1 text-xs font-medium ${tone}`}>
        <span aria-hidden>{deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '—'}</span>{' '}
        {formatPct(deltaPct)}{' '}
        <span className="font-normal text-ink-muted">vs. mês anterior</span>
      </p>
      {footer ? <p className="mt-2 text-xs text-ink-muted">{footer}</p> : null}
    </Card>
  );
}
