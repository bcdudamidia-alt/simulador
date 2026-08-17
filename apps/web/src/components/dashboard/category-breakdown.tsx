'use client';

import { useState } from 'react';
import { Card, CardHeader } from '../ui/card';
import { EmptyState } from './cash-flow-chart';
import { formatCents, formatPct } from '../../lib/format';
import type { CategorySlice } from '../../lib/types';

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

const MAX_SLICES = 7;

/**
 * Despesas por categoria — barras horizontais ordenadas, não rosca.
 *
 * A rosca é o reflexo de todo app financeiro e é a forma errada aqui: o olho
 * não compara ângulos com precisão, e justamente as categorias que importam
 * (as de meio de tabela, onde há gordura para cortar) ficam indistinguíveis.
 * Barra ordenada responde "onde foi o dinheiro" na primeira olhada, já traz o
 * valor exato ao lado e ainda cabe a variação contra o mês anterior.
 *
 * Além da 7ª categoria as cores começariam a se confundir, então o resto vira
 * "Outras" — e a tabela completa fica a um clique, nada é escondido.
 */
export function CategoryBreakdown({ data }: { data: CategorySlice[] }) {
  const [showTable, setShowTable] = useState(false);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader title="Para onde foi o dinheiro" />
        <EmptyState message="Sem despesas categorizadas neste mês." />
      </Card>
    );
  }

  const top = data.slice(0, MAX_SLICES);
  const rest = data.slice(MAX_SLICES);
  const restTotal = rest.reduce((sum, c) => sum + c.totalCents, 0);
  const restShare = rest.reduce((sum, c) => sum + c.sharePct, 0);

  const slices = [
    ...top,
    ...(rest.length > 0
      ? [
          {
            slug: 'outras',
            name: `Outras ${rest.length} categorias`,
            color: 'var(--ink-muted)',
            totalCents: restTotal,
            sharePct: Number(restShare.toFixed(1)),
            previousTotalCents: rest.reduce((sum, c) => sum + c.previousTotalCents, 0),
          },
        ]
      : []),
  ];

  const max = Math.max(...slices.map((s) => s.totalCents));
  const total = data.reduce((sum, c) => sum + c.totalCents, 0);

  return (
    <Card>
      <CardHeader
        title="Para onde foi o dinheiro"
        subtitle={`${formatCents(total)} em ${data.length} categorias`}
        action={
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
          >
            {showTable ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        }
      />

      {showTable ? (
        <CategoryTable data={data} />
      ) : (
        <ul className="space-y-3">
          {slices.map((slice, index) => {
            const change =
              slice.previousTotalCents > 0
                ? ((slice.totalCents - slice.previousTotalCents) / slice.previousTotalCents) * 100
                : null;

            return (
              <li key={slice.slug}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  {/* Rótulo direto: o texto usa tinta, nunca a cor da série —
                      amarelo e água são ilegíveis como texto na superfície. */}
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink-primary">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: SERIES[index] ?? 'var(--ink-muted)' }}
                    />
                    <span className="truncate">{slice.name}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink-primary">
                    {formatCents(slice.totalCents)}
                    <span className="ml-1.5 text-xs font-normal text-ink-muted">
                      {slice.sharePct.toFixed(0)}%
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--gridline)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(1, (slice.totalCents / max) * 100)}%`,
                        background: SERIES[index] ?? 'var(--ink-muted)',
                      }}
                    />
                  </div>
                  {change !== null && Math.abs(change) >= 10 ? (
                    <span
                      className="w-16 shrink-0 text-right text-[11px] font-medium tabular-nums"
                      style={{ color: change > 0 ? 'var(--value-down)' : 'var(--value-up)' }}
                      title={`Mês anterior: ${formatCents(slice.previousTotalCents)}`}
                    >
                      {formatPct(change, 0)}
                    </span>
                  ) : (
                    <span className="w-16 shrink-0" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Tabela completa: nada fica gated atrás do gráfico. */
function CategoryTable({ data }: { data: CategorySlice[] }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-xs text-ink-muted">
          <tr className="border-b border-[var(--hairline)]">
            <th scope="col" className="py-2 font-medium">Categoria</th>
            <th scope="col" className="py-2 text-right font-medium">Este mês</th>
            <th scope="col" className="py-2 text-right font-medium">Mês anterior</th>
            <th scope="col" className="py-2 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {data.map((slice) => (
            <tr key={slice.slug} className="border-b border-[var(--hairline)] last:border-0">
              <td className="py-2 text-ink-primary">{slice.name}</td>
              <td className="py-2 text-right tabular-nums text-ink-primary">
                {formatCents(slice.totalCents)}
              </td>
              <td className="py-2 text-right tabular-nums text-ink-secondary">
                {formatCents(slice.previousTotalCents)}
              </td>
              <td className="py-2 text-right tabular-nums text-ink-secondary">
                {slice.sharePct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
