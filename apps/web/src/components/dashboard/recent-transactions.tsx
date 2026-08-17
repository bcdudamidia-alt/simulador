import { Badge, Card, CardHeader } from '../ui/card';
import { EmptyState } from './cash-flow-chart';
import { formatCents, formatDayShort } from '../../lib/format';
import type { RecentTransaction } from '../../lib/types';

/**
 * Extrato consolidado — todas as contas e cartões na mesma lista.
 *
 * O selo "revisar" existe porque a categorização automática é honesta sobre a
 * própria incerteza: abaixo de 70% de confiança, a transação é marcada em vez
 * de fingir acerto. Esconder o palpite ruim é o que faz o usuário parar de
 * confiar no relatório inteiro.
 */
export function RecentTransactions({
  transactions,
  pendingReviewCount,
}: {
  transactions: RecentTransaction[];
  pendingReviewCount: number;
}) {
  return (
    <Card>
      <CardHeader
        title="Últimos lançamentos"
        subtitle="Todas as contas e cartões"
        action={
          pendingReviewCount > 0 ? (
            <a
              href="/transacoes?needsReview=true"
              className="rounded-md border border-[var(--status-warning)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning)] transition-opacity hover:opacity-80"
            >
              {pendingReviewCount} a revisar
            </a>
          ) : null
        }
      />

      {transactions.length === 0 ? (
        <EmptyState message="Nenhum lançamento ainda. Importe um extrato .ofx para começar." />
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {transactions.map((tx) => (
            <li key={tx.id} className="flex items-center gap-3 py-2.5">
              <span className="w-12 shrink-0 text-xs tabular-nums text-ink-muted">
                {formatDayShort(tx.postedAt)}
              </span>

              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: tx.categoryColor ?? 'var(--ink-muted)' }}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-primary">{tx.description}</p>
                <p className="truncate text-xs text-ink-muted">
                  {tx.categoryName ?? 'Sem categoria'} · {tx.origin}
                </p>
              </div>

              {tx.needsReview ? (
                <Badge tone="warning">
                  <span aria-hidden className="mr-1">?</span>revisar
                </Badge>
              ) : null}

              <span
                className="shrink-0 text-sm font-medium tabular-nums"
                style={{
                  color: tx.amountCents > 0 ? 'var(--value-up)' : 'var(--ink-primary)',
                }}
              >
                {tx.amountCents > 0 ? '+' : ''}
                {formatCents(tx.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
