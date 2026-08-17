'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, Legend } from '../ui/card';
import { formatCents, formatCentsCompact, formatMonthLong, formatMonthShort } from '../../lib/format';
import type { CashFlowPoint } from '../../lib/types';

/**
 * Fluxo de caixa — entradas × saídas nos últimos 6 meses.
 *
 * Colunas agrupadas, e não linha dupla nem eixo duplo: as duas séries estão na
 * MESMA unidade (reais), então compartilham um eixo. Um segundo eixo Y aqui
 * permitiria "ajustar" a escala até despesa parecer menor que receita — é o
 * erro mais comum em dashboard financeiro e ele mente por construção.
 *
 * O saldo (entradas − saídas) não vira uma terceira série: ele já é a diferença
 * visível entre as duas colunas, e aparece com número exato no tooltip.
 */
export function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  const series = data.map((point) => ({
    month: point.month,
    label: formatMonthShort(point.month),
    entradas: point.incomeCents / 100,
    saidas: point.expensesCents / 100,
    saldo: point.balanceCents / 100,
  }));

  const legend = [
    { label: 'Entradas', color: 'var(--series-1)' },
    { label: 'Saídas', color: 'var(--series-2)' },
  ];

  if (series.length === 0) {
    return (
      <Card>
        <CardHeader title="Fluxo de caixa" />
        <EmptyState message="Importe um extrato para ver a evolução mês a mês." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Fluxo de caixa"
        subtitle="Últimos 6 meses, por competência"
        action={<Legend items={legend} />}
      />

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
            <CartesianGrid
              vertical={false}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--baseline)' }}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              dy={4}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={68}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(value: number) => formatCentsCompact(value * 100)}
            />
            <Tooltip
              cursor={{ fill: 'var(--gridline)', fillOpacity: 0.35 }}
              content={<CashFlowTooltip />}
            />
            {/* radius: canto arredondado só no topo — a base fica quadrada na linha zero */}
            <Bar dataKey="entradas" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="saidas" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

interface TooltipPayload {
  payload: { month: string; entradas: number; saidas: number; saldo: number };
}

function CashFlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-sm">
      <p className="mb-1.5 font-semibold text-ink-primary">{formatMonthLong(point.month)}</p>
      <TooltipRow color="var(--series-1)" label="Entradas" value={point.entradas} />
      <TooltipRow color="var(--series-2)" label="Saídas" value={point.saidas} />
      <div className="mt-1.5 border-t border-[var(--hairline)] pt-1.5">
        <p className="flex justify-between gap-6 text-ink-secondary">
          <span>Saldo</span>
          <strong
            className="tabular-nums font-semibold"
            style={{ color: point.saldo >= 0 ? 'var(--value-up)' : 'var(--value-down)' }}
          >
            {formatCents(point.saldo * 100)}
          </strong>
        </p>
      </div>
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <p className="flex items-center justify-between gap-6 text-ink-secondary">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className="tabular-nums text-ink-primary">{formatCents(value * 100)}</span>
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[var(--hairline)] px-6 text-center text-sm text-ink-muted">
      {message}
    </div>
  );
}
