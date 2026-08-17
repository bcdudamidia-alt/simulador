'use client';

import { useState } from 'react';
import { Badge, Card, CardHeader } from '../ui/card';
import { api } from '../../lib/api';
import { formatMonthLong } from '../../lib/format';
import type { MonthlyInsights } from '../../lib/types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Análise mensal gerada por IA.
 *
 * Três decisões de produto embutidas aqui:
 *
 *  1. A análise é PEDIDA, não automática. Ela custa dinheiro por chamada e o
 *     casal não quer um conselheiro falando sozinho todo dia.
 *  2. A origem é sempre declarada ("gerado por IA"). Um número que veio de um
 *     modelo não pode se passar por extrato.
 *  3. Recomendação vem com a economia estimada e o impacto na meta. Conselho
 *     financeiro sem número é frase de biscoito da sorte.
 */
export function InsightsPanel({
  month,
  initial,
  disabled = false,
}: {
  month: string;
  initial?: MonthlyInsights;
  /** Em demonstração não há dado real para analisar — e a chamada é paga. */
  disabled?: boolean;
}) {
  const [insights, setInsights] = useState<MonthlyInsights | undefined>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getInsights(month, Boolean(insights));
      setInsights(result.payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar a análise.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Análise do mês"
        subtitle={`${formatMonthLong(month)} · gerado por IA`}
        action={
          <button
            type="button"
            onClick={generate}
            disabled={loading || disabled}
            title={disabled ? 'Disponível depois de entrar com sua conta.' : undefined}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Analisando…' : insights ? 'Atualizar' : 'Gerar análise'}
          </button>
        }
      />

      {error ? (
        <p className="rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]">
          {error}
        </p>
      ) : null}

      {!insights && !error ? (
        <p className="text-sm text-ink-secondary">
          {disabled
            ? 'Entre com sua conta para gerar a leitura do mês.'
            : 'Gere uma leitura do mês fechado: o que mudou, onde está a gordura e quanto isso antecipa (ou atrasa) as metas de vocês.'}
        </p>
      ) : null}

      {insights ? (
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <div className="shrink-0 text-center">
              <p className="text-3xl font-semibold tabular-nums text-ink-primary">
                {insights.saude_financeira.nota.toFixed(1)}
              </p>
              <p className="text-[11px] text-ink-muted">de 10</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-ink-primary">{insights.resumo}</p>
              <p className="mt-1.5 text-xs text-ink-secondary">
                {insights.saude_financeira.justificativa}
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
                Taxa de poupança:{' '}
                <strong className="tabular-nums text-ink-secondary">
                  {insights.saude_financeira.taxa_poupanca_pct.toFixed(1)}%
                </strong>
                <TrendBadge trend={insights.saude_financeira.tendencia} />
              </p>
            </div>
          </div>

          {insights.destaques.length > 0 ? (
            <ul className="space-y-2">
              {insights.destaques.map((item) => (
                <li
                  key={item.titulo}
                  className="rounded-lg border border-[var(--hairline)] px-3 py-2.5"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-primary">
                    <HighlightBadge tipo={item.tipo} />
                    {item.titulo}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">{item.descricao}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {insights.recomendacoes.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-ink-muted">O que fazer agora</h3>
              <ol className="space-y-2">
                {insights.recomendacoes.map((rec, index) => (
                  <li key={rec.acao} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-ink-primary">{rec.acao}</p>
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        Economia estimada:{' '}
                        <strong className="tabular-nums">
                          {brl.format(rec.economia_mensal_estimada)}/mês
                        </strong>{' '}
                        · {rec.impacto_nas_metas}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <p className="border-t border-[var(--hairline)] pt-3 text-xs text-ink-muted">
            Projeção para o próximo mês:{' '}
            <strong className="tabular-nums text-ink-secondary">
              {brl.format(insights.projecao_proximo_mes.despesa_estimada)}
            </strong>{' '}
            em despesas — sendo{' '}
            {brl.format(insights.projecao_proximo_mes.compromissos_ja_assumidos)} já comprometidos
            em parcelas. {insights.projecao_proximo_mes.base}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function HighlightBadge({ tipo }: { tipo: 'alerta' | 'conquista' | 'observacao' }) {
  const config = {
    alerta: { tone: 'serious' as const, icon: '!', label: 'Alerta' },
    conquista: { tone: 'good' as const, icon: '✓', label: 'Conquista' },
    observacao: { tone: 'neutral' as const, icon: 'i', label: 'Observação' },
  }[tipo];

  return (
    <Badge tone={config.tone}>
      <span aria-hidden className="mr-1">{config.icon}</span>
      {config.label}
    </Badge>
  );
}

function TrendBadge({ trend }: { trend: 'melhorando' | 'estavel' | 'piorando' }) {
  const config = {
    melhorando: { tone: 'good' as const, icon: '▲', label: 'melhorando' },
    estavel: { tone: 'neutral' as const, icon: '—', label: 'estável' },
    piorando: { tone: 'serious' as const, icon: '▼', label: 'piorando' },
  }[trend];

  return (
    <Badge tone={config.tone}>
      <span aria-hidden className="mr-1">{config.icon}</span>
      {config.label}
    </Badge>
  );
}
