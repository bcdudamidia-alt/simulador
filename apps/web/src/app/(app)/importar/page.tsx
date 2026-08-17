'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Badge, Card, CardHeader } from '../../../components/ui/card';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import type { Account, Card as CreditCard, ImportBatch, ImportResult } from '../../../lib/types';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['.ofx', '.qfx', '.csv', '.txt'];

/**
 * Importação de extratos e faturas.
 *
 * O ponto de atrito real desta tela não é o upload — é a ansiedade de quem
 * acabou de jogar o extrato do banco em um site. Por isso ela mostra
 * explicitamente o que aconteceu com cada linha (importadas, duplicadas,
 * ignoradas), e não um "pronto!" genérico.
 *
 * Validamos extensão e tamanho aqui só para dar erro rápido; a validação que
 * conta é a da API, que confere magic bytes e não confia na extensão — que
 * quem envia escolhe.
 */
export default function ImportPage() {
  const { status, canWrite } = useSession();
  const isDemo = status === 'demo';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [destination, setDestination] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (isDemo) return;
    const [accountList, cardList, batches] = await Promise.all([
      api.getAccounts(),
      api.getCards(),
      api.getImports(),
    ]);
    setAccounts(accountList);
    setCards(cardList);
    setHistory(batches);
    setDestination((current) => current || (accountList[0] ? `account:${accountList[0].id}` : ''));
  }, [isDemo]);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Erro ao carregar contas.');
    });
  }, [reload]);

  function pickFile(candidate: File | undefined): void {
    setResult(null);
    setError(null);
    if (!candidate) return;

    const ext = `.${candidate.name.toLowerCase().split('.').pop() ?? ''}`;
    if (!ACCEPTED.includes(ext)) {
      setError(`Formato ${ext} não aceito. Envie ${ACCEPTED.join(', ')}.`);
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError('Arquivo maior que 10 MB.');
      return;
    }
    setFile(candidate);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  async function submit(): Promise<void> {
    if (!file || !destination) return;
    setBusy(true);
    setError(null);

    const [kind, id] = destination.split(':');
    try {
      const response = await api.importStatement(
        file,
        kind === 'account' ? { accountId: id } : { creditCardId: id },
      );
      setResult(response);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha no envio do arquivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink-primary">Importar extrato</h1>
        <p className="text-sm text-ink-muted">
          Baixe o .ofx no app do seu banco e solte aqui. Nada de digitar lançamento a lançamento.
        </p>
      </header>

      <Card className="mb-4">
        <CardHeader title="Novo arquivo" subtitle="OFX, QFX ou CSV · até 10 MB" />

        <label htmlFor="destination" className="mb-1 block text-xs font-medium text-ink-secondary">
          Destino
        </label>
        <select
          id="destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          disabled={isDemo}
          className="mb-4 w-full rounded-lg border border-[var(--hairline)] bg-surface px-3 py-2 text-sm text-ink-primary disabled:opacity-50"
        >
          <option value="">Selecione a conta ou o cartão…</option>
          {accounts.length > 0 ? (
            <optgroup label="Contas">
              {accounts.map((account) => (
                <option key={account.id} value={`account:${account.id}`}>
                  {account.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {cards.length > 0 ? (
            <optgroup label="Cartões">
              {cards.map((card) => (
                <option key={card.id} value={`card:${card.id}`}>
                  {card.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? 'border-brand bg-brand-soft/20' : 'border-[var(--hairline)]'
          }`}
        >
          <p className="text-sm text-ink-secondary">
            {file ? (
              <>
                <strong className="font-medium text-ink-primary">{file.name}</strong>{' '}
                <span className="text-ink-muted">({(file.size / 1024).toFixed(0)} KB)</span>
              </>
            ) : (
              'Arraste o arquivo até aqui'
            )}
          </p>

          <input
            ref={inputRef}
            id="file"
            type="file"
            accept={ACCEPTED.join(',')}
            onChange={(e) => pickFile(e.target.files?.[0])}
            className="sr-only"
          />
          <label
            htmlFor="file"
            className="mt-3 inline-block cursor-pointer rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
          >
            {file ? 'Trocar arquivo' : 'ou escolher do computador'}
          </label>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!file || !destination || busy || !canWrite}
          className="mt-4 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Processando…' : isDemo ? 'Indisponível na demonstração' : 'Importar'}
        </button>

        <p className="mt-3 text-xs text-ink-muted">
          Reenviar o mesmo arquivo não duplica nada: a importação é identificada pelo conteúdo.
        </p>
      </Card>

      {result ? <ImportSummary result={result} /> : null}

      {history.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Importações anteriores" />
          <ul className="divide-y divide-[var(--hairline)]">
            {history.map((batch) => (
              <li key={batch.id} className="flex items-center gap-3 py-2.5">
                <span className="w-10 shrink-0 text-[11px] font-medium uppercase text-ink-muted">
                  {batch.format}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-primary">{batch.filename}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {batch.account?.name ?? batch.creditCard?.name ?? '—'} ·{' '}
                    {batch.importedCount} importadas
                    {batch.duplicateCount > 0 ? ` · ${batch.duplicateCount} duplicadas` : ''}
                    {batch.statementStart && batch.statementEnd
                      ? ` · ${formatDate(batch.statementStart.slice(0, 10))} a ${formatDate(batch.statementEnd.slice(0, 10))}`
                      : ''}
                  </p>
                </div>
                <Badge tone={batch.status === 'completed' ? 'good' : batch.status === 'failed' ? 'critical' : 'warning'}>
                  {batch.status === 'completed'
                    ? 'ok'
                    : batch.status === 'partial'
                      ? 'parcial'
                      : batch.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Resultado detalhado.
 *
 * Mostra duplicadas e ignoradas com o mesmo peso das importadas: se o app
 * silenciar as 12 linhas que pulou, o casal só descobre a diferença meses
 * depois, quando o saldo não fecha — e aí não confia em mais nada.
 */
function ImportSummary({ result }: { result: ImportResult }) {
  const duplicate = result.status === 'duplicate';

  return (
    <Card>
      <CardHeader
        title={duplicate ? 'Arquivo já importado' : 'Importação concluída'}
        subtitle={
          result.period.start && result.period.end
            ? `Período de ${formatDate(result.period.start)} a ${formatDate(result.period.end)}`
            : undefined
        }
      />

      {duplicate ? (
        <p className="text-sm text-ink-secondary">
          Este arquivo já havia sido enviado antes. Nada foi duplicado.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Importadas" value={result.imported} tone="good" />
            <Stat label="Duplicadas" value={result.duplicates} />
            <Stat label="A revisar" value={result.needsReview} tone={result.needsReview > 0 ? 'warning' : undefined} />
            <Stat label="Ignoradas" value={result.errors} tone={result.errors > 0 ? 'serious' : undefined} />
          </div>

          {result.warnings.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-ink-secondary">
                Ver {result.warnings.length} aviso(s)
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                {result.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {result.needsReview > 0 ? (
            <a
              href="/transacoes?needsReview=true"
              className="mt-4 inline-block rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
            >
              Revisar categorias sugeridas →
            </a>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warning' | 'serious';
}) {
  const color = tone ? `var(--status-${tone})` : 'var(--ink-primary)';
  return (
    <div className="rounded-lg border border-[var(--hairline)] px-3 py-2.5">
      <p className="text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
