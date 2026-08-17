'use client';

import { Badge, Card, CardHeader } from '../ui/card';
import { EmptyState } from './cash-flow-chart';
import { formatCents, formatMonthsRemaining } from '../../lib/format';
import type { GoalProgress } from '../../lib/types';

/**
 * Metas e projetos do casal.
 *
 * O que faz esta seção funcionar não é a barra de progresso — é a frase
 * "guardando R$ X por mês vocês chegam em <data>". Progresso mostra onde vocês
 * estão; o aporte necessário mostra o que fazer amanhã de manhã.
 *
 * A divisão por membro aparece como fato neutro (quem aportou quanto), nunca
 * como comparação avaliativa. São duas pessoas lendo a mesma tela juntas.
 */
export function GoalsPanel({ goals }: { goals: GoalProgress[] }) {
  if (goals.length === 0) {
    return (
      <Card>
        <CardHeader title="Metas do casal" />
        <EmptyState message="Criem a primeira meta: casamento, entrada do apê, aquela viagem." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Metas do casal"
        subtitle={`${goals.length} meta${goals.length === 1 ? '' : 's'} em andamento`}
      />
      <ul className="space-y-5">
        {goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} />
        ))}
      </ul>
    </Card>
  );
}

const PACE: Record<
  GoalProgress['pace'],
  { label: string; tone: 'good' | 'warning' | 'serious' | 'critical' | 'neutral'; icon: string }
> = {
  achieved: { label: 'Meta atingida', tone: 'good', icon: '✓' },
  ahead: { label: 'Adiantada', tone: 'good', icon: '↑' },
  on_track: { label: 'No ritmo', tone: 'good', icon: '→' },
  behind: { label: 'Atrasada', tone: 'serious', icon: '↓' },
  stalled: { label: 'Sem aportes', tone: 'critical', icon: '!' },
};

function GoalRow({ goal }: { goal: GoalProgress }) {
  const pace = PACE[goal.pace];
  const remaining = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);

  return (
    <li>
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-primary">{goal.name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatCents(goal.currentAmountCents)} de {formatCents(goal.targetAmountCents)} ·{' '}
            {formatMonthsRemaining(goal.monthsRemaining)}
          </p>
        </div>
        {/* Estado nunca por cor sozinha: ícone + rótulo sempre juntos. */}
        <Badge tone={pace.tone}>
          <span aria-hidden className="mr-1">{pace.icon}</span>
          {pace.label}
        </Badge>
      </div>

      {/* Medidor: trilho é um passo mais claro do mesmo tom, para o estado
          ser legível ao longo da barra inteira e não só no preenchimento. */}
      <div
        className="h-2.5 overflow-hidden rounded-full bg-[var(--gridline)]"
        role="progressbar"
        aria-valuenow={Math.round(goal.progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progresso da meta ${goal.name}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${goal.progressPct}%`, background: goal.color }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-ink-secondary">
          <strong className="font-semibold text-ink-primary tabular-nums">
            {goal.progressPct.toFixed(0)}%
          </strong>{' '}
          · faltam {formatCents(remaining)}
        </p>

        {remaining > 0 ? (
          <p className="text-xs text-ink-secondary">
            Guardar{' '}
            <strong className="font-semibold text-ink-primary tabular-nums">
              {formatCents(goal.requiredMonthlyCents)}/mês
            </strong>{' '}
            {goal.averageMonthlyCents > 0 ? (
              <span className="text-ink-muted">
                (ritmo atual: {formatCents(goal.averageMonthlyCents)})
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {goal.byMember.length > 1 ? (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Aportes:{' '}
          {goal.byMember
            .map((m) => `${m.name} ${formatCents(m.amountCents)} (${m.sharePct.toFixed(0)}%)`)
            .join(' · ')}
        </p>
      ) : null}

      {goal.pace === 'behind' && goal.projectedCompletion ? (
        <p className="mt-1.5 text-[11px] text-[var(--status-serious)]">
          No ritmo atual, a meta é atingida só em{' '}
          {new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(new Date(goal.projectedCompletion))}
          .
        </p>
      ) : null}
    </li>
  );
}
