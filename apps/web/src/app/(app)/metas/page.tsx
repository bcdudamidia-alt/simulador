'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge, Card, CardHeader } from '../../../components/ui/card';
import { FormActions, Modal, SelectField, TextField, parseToCents } from '../../../components/ui/form';
import { api } from '../../../lib/api';
import { formatCents, formatMonthsRemaining } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { DEMO_DASHBOARD } from '../../../lib/demo-data';
import type { Goal, GoalInput, Household } from '../../../lib/types';

const KINDS: Array<{ value: GoalInput['kind']; label: string }> = [
  { value: 'property', label: 'Imóvel' },
  { value: 'wedding', label: 'Casamento' },
  { value: 'travel', label: 'Viagem' },
  { value: 'emergency_fund', label: 'Reserva de emergência' },
  { value: 'vehicle', label: 'Veículo' },
  { value: 'education', label: 'Educação' },
  { value: 'other', label: 'Outro' },
];

/** Cor sugerida por tipo de meta, na ordem fixa da paleta categórica. */
const KIND_COLOR: Record<GoalInput['kind'], string> = {
  property: '#2a78d6',
  wedding: '#e87ba4',
  travel: '#1baf7a',
  emergency_fund: '#4a3aa7',
  vehicle: '#eb6834',
  education: '#eda100',
  other: '#008300',
};

const PACE: Record<
  Goal['pace'],
  { label: string; tone: 'good' | 'serious' | 'critical' | 'neutral'; icon: string }
> = {
  achieved: { label: 'Meta atingida', tone: 'good', icon: '✓' },
  ahead: { label: 'Adiantada', tone: 'good', icon: '↑' },
  on_track: { label: 'No ritmo', tone: 'good', icon: '→' },
  behind: { label: 'Atrasada', tone: 'serious', icon: '↓' },
  stalled: { label: 'Sem aportes', tone: 'critical', icon: '!' },
};

/**
 * Metas e projetos do casal.
 *
 * A tela é organizada em torno de uma pergunta só: "quanto guardar por mês para
 * chegar lá". Progresso é contexto; o aporte necessário é a decisão. Por isso
 * cada meta traz o simulador ao alcance de um clique, e a resposta vem do
 * backend — a mesma fórmula que alimenta o painel e o prompt de IA, para os três
 * nunca divergirem.
 */
export default function GoalsPage() {
  const { canWrite, status, user } = useSession();
  const isDemo = status === 'demo';

  const [goals, setGoals] = useState<Goal[]>(isDemo ? DEMO_DASHBOARD.goals : []);
  const [household, setHousehold] = useState<Household | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [simulating, setSimulating] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDemo);

  const reload = useCallback(async () => {
    if (isDemo) {
      setGoals(DEMO_DASHBOARD.goals);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [goalList, householdData] = await Promise.all([api.getGoals(), api.getHousehold()]);
      setGoals(goalList);
      setHousehold(householdData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar as metas.');
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(goal: Goal): Promise<void> {
    if (
      !confirm(
        `Apagar a meta "${goal.name}"? Os aportes registrados nela também são apagados — o dinheiro em si continua nas contas e no extrato.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteGoal(goal.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível apagar.');
    }
  }

  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmountCents, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.currentAmountCents, 0);
  const totalMonthly = goals
    .filter((g) => g.currentAmountCents < g.targetAmountCents)
    .reduce((sum, g) => sum + g.requiredMonthlyCents, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
            Metas e projetos
          </h1>
          <p className="text-sm text-ink-muted">
            {formatCents(totalSaved)} de {formatCents(totalTarget)} guardados
            {totalMonthly > 0
              ? ` · ${formatCents(totalMonthly)}/mês para cumprir todos os prazos`
              : ''}
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
          >
            + Nova meta
          </button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <Card>
          <div className="h-40 animate-pulse rounded-lg bg-[var(--gridline)]" />
        </Card>
      ) : goals.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-ink-muted">
            Nenhuma meta ainda. Comecem pelo projeto que mais importa: casamento, entrada do apê,
            aquela viagem.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              canWrite={canWrite}
              onEdit={() => {
                setEditing(goal);
                setFormOpen(true);
              }}
              onContribute={() => setContributing(goal)}
              onSimulate={() => setSimulating(goal)}
              onRemove={() => void remove(goal)}
            />
          ))}
        </div>
      )}

      {formOpen ? (
        <GoalForm
          goal={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void reload();
          }}
        />
      ) : null}

      {contributing ? (
        <ContributionForm
          goal={contributing}
          members={household?.members.map((m) => m.user) ?? []}
          defaultUserId={user?.id ?? ''}
          onClose={() => setContributing(null)}
          onSaved={() => {
            setContributing(null);
            void reload();
          }}
        />
      ) : null}

      {simulating ? (
        <Simulator goal={simulating} demo={isDemo} onClose={() => setSimulating(null)} />
      ) : null}
    </div>
  );
}

function GoalCard({
  goal,
  canWrite,
  onEdit,
  onContribute,
  onSimulate,
  onRemove,
}: {
  goal: Goal;
  canWrite: boolean;
  onEdit: () => void;
  onContribute: () => void;
  onSimulate: () => void;
  onRemove: () => void;
}) {
  const pace = PACE[goal.pace];
  const remaining = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: goal.color }}
            />
            {goal.name}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {KINDS.find((k) => k.value === goal.kind)?.label} ·{' '}
            {formatMonthsRemaining(goal.monthsRemaining)}
          </p>
        </div>
        <Badge tone={pace.tone}>
          <span aria-hidden className="mr-1">
            {pace.icon}
          </span>
          {pace.label}
        </Badge>
      </div>

      <div
        className="h-3 overflow-hidden rounded-full bg-[var(--gridline)]"
        role="progressbar"
        aria-valuenow={Math.round(goal.progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progresso de ${goal.name}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${goal.progressPct}%`, background: goal.color }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p className="text-ink-primary">
          <strong className="font-semibold tabular-nums">
            {formatCents(goal.currentAmountCents)}
          </strong>{' '}
          <span className="text-ink-muted">de {formatCents(goal.targetAmountCents)}</span>
          <span className="ml-2 text-xs text-ink-secondary tabular-nums">
            {goal.progressPct.toFixed(0)}%
          </span>
        </p>
        {remaining > 0 ? (
          <p className="text-xs text-ink-secondary">
            Faltam {formatCents(remaining)} · guardar{' '}
            <strong className="font-semibold text-ink-primary tabular-nums">
              {formatCents(goal.requiredMonthlyCents)}/mês
            </strong>
          </p>
        ) : null}
      </div>

      {goal.averageMonthlyCents > 0 || goal.byMember.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-muted">Ritmo dos últimos 3 meses</dt>
            <dd className="tabular-nums text-ink-primary">
              {formatCents(goal.averageMonthlyCents)}/mês
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Aportado este mês</dt>
            <dd className="tabular-nums text-ink-primary">
              {formatCents(goal.contributedThisMonthCents)}
            </dd>
          </div>
          {goal.projectedCompletion && remaining > 0 ? (
            <div>
              <dt className="text-ink-muted">Neste ritmo, termina em</dt>
              <dd className="text-ink-primary">
                {new Intl.DateTimeFormat('pt-BR', {
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(goal.projectedCompletion))}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* Divisão por membro como fato neutro, nunca como comparação de mérito. */}
      {goal.byMember.length > 1 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Aportes:{' '}
          {goal.byMember
            .map((m) => `${m.name} ${formatCents(m.amountCents)} (${m.sharePct.toFixed(0)}%)`)
            .join(' · ')}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {canWrite ? (
          <button
            type="button"
            onClick={onContribute}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            Registrar aporte
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSimulate}
          className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
        >
          Simular
        </button>
        {canWrite ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs text-ink-muted transition-colors hover:text-[var(--status-critical)]"
            >
              Apagar
            </button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

function GoalForm({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [kind, setKind] = useState<GoalInput['kind']>((goal?.kind as GoalInput['kind']) ?? 'other');
  const [target, setTarget] = useState(
    goal ? (goal.targetAmountCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [initial, setInitial] = useState('');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const targetCents = parseToCents(target);
    if (targetCents <= 0) {
      setError('Informe um valor de meta maior que zero.');
      setBusy(false);
      return;
    }

    try {
      if (goal) {
        await api.updateGoal(goal.id, {
          name,
          targetAmountCents: targetCents,
          ...(targetDate ? { targetDate } : {}),
        });
      } else {
        await api.createGoal({
          name,
          kind,
          targetAmountCents: targetCents,
          initialAmountCents: initial ? parseToCents(initial) : 0,
          color: KIND_COLOR[kind],
          ...(targetDate ? { targetDate } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={goal ? 'Editar meta' : 'Nova meta'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <TextField
          label="Nome"
          id="goal-name"
          value={name}
          onChange={setName}
          placeholder="Entrada do apartamento"
          required
        />

        {goal ? null : (
          <SelectField
            label="Tipo"
            id="goal-kind"
            value={kind}
            onChange={(v) => setKind(v as GoalInput['kind'])}
            options={KINDS}
          />
        )}

        <TextField
          label="Quanto vocês precisam juntar"
          id="goal-target"
          value={target}
          onChange={setTarget}
          placeholder="120.000,00"
          required
        />

        {goal ? null : (
          <TextField
            label="Já têm guardado (opcional)"
            id="goal-initial"
            value={initial}
            onChange={setInitial}
            placeholder="0,00"
            hint="Valor que já existe hoje. Aportes futuros somam a partir daqui."
          />
        )}

        <TextField
          label="Prazo (opcional)"
          id="goal-date"
          type="date"
          value={targetDate}
          onChange={setTargetDate}
          hint="Com prazo definido, calculamos quanto guardar por mês."
        />

        {error ? (
          <p role="alert" className="text-sm text-[var(--status-critical)]">
            {error}
          </p>
        ) : null}

        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function ContributionForm({
  goal,
  members,
  defaultUserId,
  onClose,
  onSaved,
}: {
  goal: Goal;
  members: Array<{ id: string; name: string }>;
  defaultUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [userId, setUserId] = useState(defaultUserId);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [withdrawal, setWithdrawal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const cents = parseToCents(amount);
    if (cents === 0) {
      setError('Informe um valor.');
      setBusy(false);
      return;
    }

    try {
      await api.addContribution(goal.id, {
        // Resgate é o mesmo registro com sinal invertido — não é outra entidade.
        amountCents: withdrawal ? -Math.abs(cents) : Math.abs(cents),
        contributedAt: date,
        ...(note ? { note } : {}),
        ...(userId ? { userId } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Aporte em "${goal.name}"`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <TextField
          label="Valor"
          id="contrib-amount"
          value={amount}
          onChange={setAmount}
          placeholder="1.500,00"
          required
        />

        {members.length > 1 ? (
          <SelectField
            label="Quem aportou"
            id="contrib-user"
            value={userId}
            onChange={setUserId}
            options={members.map((m) => ({ value: m.id, label: m.name }))}
          />
        ) : null}

        <TextField label="Data" id="contrib-date" type="date" value={date} onChange={setDate} />

        <TextField
          label="Observação (opcional)"
          id="contrib-note"
          value={note}
          onChange={setNote}
          placeholder="13º salário"
        />

        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={withdrawal}
            onChange={(e) => setWithdrawal(e.target.checked)}
            className="rounded border-[var(--hairline)]"
          />
          É um resgate (tirar dinheiro da meta)
        </label>

        {error ? (
          <p role="alert" className="text-sm text-[var(--status-critical)]">
            {error}
          </p>
        ) : null}

        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

/**
 * Simulador de aporte.
 *
 * Duas perguntas, dois caminhos — e o cálculo vem do backend, não daqui. Se o
 * número fosse recalculado no cliente, ele divergiria do painel e do relatório
 * de IA no primeiro arredondamento diferente.
 */
function Simulator({
  goal,
  demo,
  onClose,
}: {
  goal: Goal;
  demo: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'by_amount' | 'by_date'>('by_amount');
  const [monthly, setMonthly] = useState(
    goal.requiredMonthlyCents ? (goal.requiredMonthlyCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [date, setDate] = useState(goal.targetDate ?? '');
  const [result, setResult] = useState<{
    requiredMonthlyCents: number;
    completionDate: string;
    monthsToComplete: number;
    totalToSaveCents: number;
    deltaVsCurrentPaceCents: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (demo) {
      setError('A simulação usa dados reais — entre com sua conta para usá-la.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.simulateGoal(
          goal.id,
          mode === 'by_amount'
            ? { monthlyContributionCents: parseToCents(monthly) }
            : { targetDate: date },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível simular.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Simular "${goal.name}"`} onClose={onClose}>
      <form onSubmit={(e) => void run(e)} className="space-y-3">
        <div
          role="radiogroup"
          aria-label="O que você quer descobrir"
          className="flex gap-0.5 rounded-lg border border-[var(--hairline)] p-0.5"
        >
          {(
            [
              ['by_amount', 'Guardando X por mês…'],
              ['by_date', 'Para terminar em…'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                setMode(value);
                setResult(null);
              }}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                mode === value
                  ? 'bg-[var(--gridline)] font-medium text-ink-primary'
                  : 'text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'by_amount' ? (
          <TextField
            label="Aporte mensal"
            id="sim-monthly"
            value={monthly}
            onChange={setMonthly}
            placeholder="1.500,00"
            required
          />
        ) : (
          <TextField
            label="Data desejada"
            id="sim-date"
            type="date"
            value={date}
            onChange={setDate}
            required
          />
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Calculando…' : 'Calcular'}
        </button>

        {error ? (
          <p role="alert" className="text-sm text-[var(--status-critical)]">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="rounded-lg border border-[var(--hairline)] p-4">
            <p className="text-sm text-ink-primary">
              Guardando{' '}
              <strong className="font-semibold tabular-nums">
                {formatCents(result.requiredMonthlyCents)}
              </strong>{' '}
              por mês, vocês chegam lá em{' '}
              <strong className="font-semibold">
                {result.monthsToComplete} {result.monthsToComplete === 1 ? 'mês' : 'meses'}
              </strong>{' '}
              —{' '}
              {new Intl.DateTimeFormat('pt-BR', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(result.completionDate))}
              .
            </p>

            <p className="mt-2 text-xs text-ink-secondary">
              Falta juntar {formatCents(result.totalToSaveCents)}.{' '}
              {result.deltaVsCurrentPaceCents > 0 ? (
                <>
                  É{' '}
                  <strong className="text-[var(--status-serious)]">
                    {formatCents(result.deltaVsCurrentPaceCents)} a mais
                  </strong>{' '}
                  do que vocês estão guardando hoje.
                </>
              ) : (
                <>
                  Isso já está{' '}
                  <strong className="text-[var(--value-up)]">
                    dentro do ritmo atual de vocês
                  </strong>
                  .
                </>
              )}
            </p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
