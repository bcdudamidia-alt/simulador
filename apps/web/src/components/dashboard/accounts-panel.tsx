import { Badge, Card, CardHeader } from '../ui/card';
import { formatCents, formatDate } from '../../lib/format';
import type { AccountSummary, CardSummary } from '../../lib/types';

const ACCOUNT_LABEL: Record<AccountSummary['type'], string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  investment: 'Investimento',
  cash: 'Dinheiro',
  other: 'Outra',
};

/**
 * Contas e cartões — o painel "multi-conta" propriamente dito.
 *
 * A distinção conjunta × individual é mostrada com texto ("Conjunta" / nome do
 * dono), não com cor: em uma conta compartilhada, saber de quem é o dinheiro é
 * informação de primeira classe e não pode depender de decifrar uma legenda.
 */
export function AccountsPanel({
  accounts,
  cards,
}: {
  accounts: AccountSummary[];
  cards: CardSummary[];
}) {
  return (
    <Card>
      <CardHeader
        title="Contas e cartões"
        subtitle={`${accounts.length} conta${accounts.length === 1 ? '' : 's'} · ${cards.length} cartão${cards.length === 1 ? '' : 'ões'}`}
      />

      <ul className="space-y-2.5">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex items-center gap-3 rounded-lg border border-[var(--hairline)] px-3 py-2.5"
          >
            <span
              aria-hidden
              className="h-8 w-1 shrink-0 rounded-full"
              style={{ background: account.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-primary">{account.name}</p>
              <p className="text-xs text-ink-muted">
                {ACCOUNT_LABEL[account.type]} ·{' '}
                {account.isShared ? 'Conjunta' : (account.ownerName ?? 'Individual')}
              </p>
            </div>
            <span
              className="shrink-0 text-sm font-semibold tabular-nums"
              style={{
                color: account.balanceCents < 0 ? 'var(--value-down)' : 'var(--ink-primary)',
              }}
            >
              {formatCents(account.balanceCents)}
            </span>
          </li>
        ))}
      </ul>

      {cards.length > 0 ? (
        <>
          <h3 className="mt-5 mb-2.5 text-xs font-semibold text-ink-muted">Faturas</h3>
          <ul className="space-y-2.5">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function CardRow({ card }: { card: CardSummary }) {
  // Uso do limite é severidade, não série: acima de 80% o tom muda porque
  // isso muda uma decisão (parcelar, adiantar pagamento, não usar).
  const usage = card.usagePct ?? 0;
  const meterColor =
    usage >= 90
      ? 'var(--status-critical)'
      : usage >= 70
        ? 'var(--status-serious)'
        : 'var(--brand)';

  return (
    <li className="rounded-lg border border-[var(--hairline)] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ background: card.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-primary">{card.name}</p>
          <p className="text-xs text-ink-muted">
            {card.dueDate ? `Vence em ${formatDate(card.dueDate)}` : 'Sem fatura aberta'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-ink-primary">
            {formatCents(card.currentStatementCents)}
          </p>
          {card.status === 'overdue' ? (
            <Badge tone="critical">
              <span aria-hidden className="mr-1">!</span>Atrasada
            </Badge>
          ) : null}
        </div>
      </div>

      {card.limitCents ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--gridline)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, usage)}%`, background: meterColor }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
            {usage.toFixed(0)}% de {formatCents(card.limitCents)}
          </span>
        </div>
      ) : null}
    </li>
  );
}
