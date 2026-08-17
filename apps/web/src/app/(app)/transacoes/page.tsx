'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardHeader } from '../../../components/ui/card';
import { api } from '../../../lib/api';
import { formatCents, formatDate } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import type {
  Account,
  Card as CreditCard,
  Category,
  Transaction,
  TransactionFilters,
} from '../../../lib/types';

/**
 * Extrato consolidado — todas as contas e cartões na mesma lista.
 *
 * A funcionalidade central desta tela não é listar: é **corrigir**. Cada linha
 * traz um seletor de categoria que, ao mudar, cria uma regra no backend e
 * reclassifica as transações irmãs. O usuário corrige "PAG*ESTUDIO MOVIMENTO"
 * uma vez e nunca mais vê aquilo errado.
 *
 * Por isso a fila "a revisar" é a primeira coisa que a tela oferece: é o
 * trabalho que efetivamente melhora o produto para o mês seguinte.
 */
export default function TransactionsPage() {
  const { canWrite, status } = useSession();
  const isDemo = status === 'demo';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>({ limit: 50 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Lê `?needsReview=true` — é o link que a tela de importação oferece.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('needsReview') === 'true') {
      setFilters((f) => ({ ...f, needsReview: 'true' }));
    }
  }, []);

  useEffect(() => {
    if (isDemo) {
      setLoading(false);
      return;
    }
    void Promise.all([api.getCategories(), api.getAccounts(), api.getCards()])
      .then(([categoryList, accountList, cardList]) => {
        setCategories(categoryList);
        setAccounts(accountList);
        setCards(cardList);
      })
      .catch(() => undefined);
  }, [isDemo]);

  const load = useCallback(
    async (query: TransactionFilters, append = false) => {
      if (isDemo) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await api.getTransactions(query);
        setTransactions((current) => (append ? [...current, ...page.data] : page.data));
        setNextCursor(page.pagination.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar os lançamentos.');
      } finally {
        setLoading(false);
      }
    },
    [isDemo],
  );

  useEffect(() => {
    void load(filters);
  }, [load, filters]);

  async function recategorize(transactionId: string, categoryId: string): Promise<void> {
    // Atualização otimista: a correção é a ação mais repetida da tela e esperar
    // o round-trip a cada linha tornaria a fila de revisão insuportável.
    const previous = transactions;
    const category = categories.find((c) => c.id === categoryId) ?? null;
    setTransactions((current) =>
      current.map((t) =>
        t.id === transactionId
          ? { ...t, category, categorySource: 'user', needsReview: false }
          : t,
      ),
    );

    try {
      const result = await api.recategorize(transactionId, categoryId, true);
      setToast(
        result.transactionsUpdated > 1
          ? `${result.transactionsUpdated} lançamentos parecidos foram reclassificados junto.`
          : 'Categoria atualizada.',
      );
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setTransactions(previous);
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a categoria.');
    }
  }

  const grouped = useMemo(() => groupByDay(transactions), [transactions]);
  const reviewCount = transactions.filter((t) => t.needsReview).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-primary">Lançamentos</h1>
          <p className="text-sm text-ink-muted">
            {transactions.length} lançamento{transactions.length === 1 ? '' : 's'}
            {reviewCount > 0 ? ` · ${reviewCount} aguardando revisão` : ''}
          </p>
        </div>
      </header>

      <Card className="mb-4">
        <Filters
          filters={filters}
          categories={categories}
          accounts={accounts}
          cards={cards}
          onChange={(next) => setFilters({ ...next, limit: 50 })}
        />
      </Card>

      {toast ? (
        <p
          role="status"
          className="mb-4 rounded-lg border border-[var(--status-good)] px-3 py-2 text-sm text-[var(--status-good)]"
        >
          {toast}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]"
        >
          {error}
        </p>
      ) : null}

      {isDemo ? (
        <Card>
          <p className="py-6 text-center text-sm text-ink-muted">
            O extrato completo fica disponível depois de entrar com sua conta.
          </p>
        </Card>
      ) : loading && transactions.length === 0 ? (
        <Card>
          <div className="h-64 animate-pulse rounded-lg bg-[var(--gridline)]" />
        </Card>
      ) : transactions.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-ink-muted">
            Nenhum lançamento com esses filtros.{' '}
            <a href="/importar" className="text-brand underline-offset-4 hover:underline">
              Importar um extrato
            </a>
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          {grouped.map(([day, items]) => (
            <section key={day}>
              <h2 className="sticky top-0 z-10 border-b border-[var(--hairline)] bg-surface px-5 py-2 text-xs font-medium text-ink-muted">
                {formatDate(day)}
              </h2>
              <ul className="divide-y divide-[var(--hairline)]">
                {items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    categories={categories}
                    canWrite={canWrite}
                    onRecategorize={recategorize}
                  />
                ))}
              </ul>
            </section>
          ))}

          {nextCursor ? (
            <div className="border-t border-[var(--hairline)] p-4 text-center">
              <button
                type="button"
                onClick={() => void load({ ...filters, cursor: nextCursor }, true)}
                disabled={loading}
                className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-[var(--gridline)] disabled:opacity-50"
              >
                {loading ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function TransactionRow({
  transaction: tx,
  categories,
  canWrite,
  onRecategorize,
}: {
  transaction: Transaction;
  categories: Category[];
  canWrite: boolean;
  onRecategorize: (id: string, categoryId: string) => Promise<void>;
}) {
  const origin = tx.account ?? tx.creditCard;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <span
        aria-hidden
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: tx.category?.color ?? 'var(--ink-muted)' }}
      />

      <div className="min-w-[12rem] flex-1">
        <p className="text-sm text-ink-primary">
          {tx.description}
          {tx.installmentNumber ? (
            <span className="ml-1.5 text-xs text-ink-muted">
              {tx.installmentNumber}/{tx.installmentTotal}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-ink-muted">
          {origin?.name ?? '—'}
          {tx.paidBy ? ` · pago por ${tx.paidBy.name}` : ''}
          {tx.sharing === 'personal' ? ' · pessoal' : ''}
        </p>
      </div>

      {/* O seletor é a ação principal da linha, não um detalhe de edição. */}
      {canWrite ? (
        <select
          value={tx.category?.id ?? ''}
          onChange={(e) => void onRecategorize(tx.id, e.target.value)}
          aria-label={`Categoria de ${tx.description}`}
          className={`max-w-[11rem] rounded-md border bg-surface px-2 py-1 text-xs text-ink-secondary ${
            tx.needsReview ? 'border-[var(--status-warning)]' : 'border-[var(--hairline)]'
          }`}
        >
          <option value="" disabled>
            Sem categoria
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-ink-muted">{tx.category?.name ?? 'Sem categoria'}</span>
      )}

      {tx.needsReview ? (
        <Badge tone="warning">
          <span aria-hidden className="mr-1">?</span>revisar
        </Badge>
      ) : tx.categorySource === 'ai' ? (
        <Badge tone="neutral">IA</Badge>
      ) : null}

      <span
        className="w-28 shrink-0 text-right text-sm font-medium tabular-nums"
        style={{ color: tx.amountCents > 0 ? 'var(--value-up)' : 'var(--ink-primary)' }}
      >
        {tx.amountCents > 0 ? '+' : ''}
        {formatCents(tx.amountCents)}
      </span>
    </li>
  );
}

function Filters({
  filters,
  categories,
  accounts,
  cards,
  onChange,
}: {
  filters: TransactionFilters;
  categories: Category[];
  accounts: Account[];
  cards: CreditCard[];
  onChange: (filters: TransactionFilters) => void;
}) {
  const [search, setSearch] = useState(filters.search ?? '');

  // Debounce da busca: sem ele, cada tecla dispara uma query no Postgres.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== (filters.search ?? '')) onChange({ ...filters, search: search || undefined });
    }, 350);
    return () => clearTimeout(timer);
  }, [search, filters, onChange]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[12rem] flex-1">
        <label htmlFor="search" className="mb-1 block text-xs font-medium text-ink-secondary">
          Buscar
        </label>
        <input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="mercado, uber, aluguel…"
          className="w-full rounded-lg border border-[var(--hairline)] bg-surface px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
        />
      </div>

      <Select
        id="category"
        label="Categoria"
        value={filters.categoryId ?? ''}
        onChange={(v) => onChange({ ...filters, categoryId: v || undefined })}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <Select
        id="origin"
        label="Conta / cartão"
        value={filters.accountId ?? filters.creditCardId ?? ''}
        onChange={(v) => {
          const isCard = cards.some((c) => c.id === v);
          onChange({
            ...filters,
            accountId: !isCard && v ? v : undefined,
            creditCardId: isCard && v ? v : undefined,
          });
        }}
        options={[
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ...cards.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      <label className="flex items-center gap-2 pb-1.5 text-xs text-ink-secondary">
        <input
          type="checkbox"
          checked={filters.needsReview === 'true'}
          onChange={(e) => onChange({ ...filters, needsReview: e.target.checked ? 'true' : undefined })}
          className="rounded border-[var(--hairline)]"
        />
        Só os que precisam de revisão
      </label>
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-secondary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--hairline)] bg-surface px-3 py-1.5 text-sm text-ink-primary"
      >
        <option value="">Todas</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Agrupa por dia mantendo a ordem que a API devolveu (mais recente primeiro). */
function groupByDay(transactions: Transaction[]): Array<[string, Transaction[]]> {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const day = tx.postedAt.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) bucket.push(tx);
    else groups.set(day, [tx]);
  }
  return [...groups];
}
