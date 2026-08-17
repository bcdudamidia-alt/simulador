'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge, Card, CardHeader } from '../../../components/ui/card';
import { FormActions, Modal, SelectField, TextField, parseToCents } from '../../../components/ui/form';
import { api } from '../../../lib/api';
import { formatCents, formatDate } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import type {
  Account,
  AccountInput,
  Card as CreditCard,
  CardInput,
  Household,
} from '../../../lib/types';

const ACCOUNT_TYPES: Array<{ value: Account['type']; label: string }> = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'investment', label: 'Investimento' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'other', label: 'Outra' },
];

const BRANDS: Array<{ value: CreditCard['brand']; label: string }> = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'elo', label: 'Elo' },
  { value: 'amex', label: 'Amex' },
  { value: 'hipercard', label: 'Hipercard' },
  { value: 'other', label: 'Outra' },
];

/**
 * Contas e cartões.
 *
 * O campo que exige cuidado é o número da conta: ele é enviado, cifrado na API
 * e nunca mais volta em claro — a tela só recebe os 4 últimos dígitos. Por isso
 * o formulário de edição mostra o mascarado e trata o campo como
 * "deixar em branco mantém o atual", em vez de tentar preencher com algo que
 * não existe no cliente.
 */
export default function AccountsPage() {
  const { canWrite, status } = useSession();
  const isDemo = status === 'demo';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [form, setForm] = useState<'account' | 'card' | null>(null);
  const [editing, setEditing] = useState<Account | CreditCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (isDemo) return;
    const [accountList, cardList, householdData] = await Promise.all([
      api.getAccounts(),
      api.getCards(),
      api.getHousehold(),
    ]);
    setAccounts(accountList);
    setCards(cardList);
    setHousehold(householdData);
  }, [isDemo]);

  useEffect(() => {
    void reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Erro ao carregar.'),
    );
  }, [reload]);

  async function removeAccount(account: Account): Promise<void> {
    if (!confirm(`Remover "${account.name}"?`)) return;
    try {
      const result = await api.deleteAccount(account.id);
      setNotice(result.message ?? 'Conta removida.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover.');
    }
  }

  async function removeCard(card: CreditCard): Promise<void> {
    if (!confirm(`Remover "${card.name}"?`)) return;
    try {
      const result = await api.deleteCard(card.id);
      setNotice(result.message ?? 'Cartão removido.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover.');
    }
  }

  const members = household?.members.map((m) => m.user) ?? [];
  const total = accounts.reduce((sum, a) => sum + a.currentBalanceCents, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
          Contas e cartões
        </h1>
        <p className="text-sm text-ink-muted">
          Saldo consolidado: {formatCents(total)}
        </p>
      </header>

      {notice ? (
        <p role="status" className="mb-4 rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm text-ink-secondary">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]">
          {error}
        </p>
      ) : null}

      {isDemo ? (
        <Card>
          <p className="py-6 text-center text-sm text-ink-muted">
            Cadastro de contas disponível depois de entrar com sua conta.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader
              title="Contas"
              action={
                canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setForm('account');
                    }}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white"
                  >
                    + Nova conta
                  </button>
                ) : null
              }
            />

            {accounts.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">
                Cadastre a primeira conta para começar a importar extratos.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {accounts.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 py-3">
                    <span
                      aria-hidden
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ background: account.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-primary">
                        {account.name}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {ACCOUNT_TYPES.find((t) => t.value === account.type)?.label} ·{' '}
                        {account.ownerUserId ? (account.owner?.name ?? 'Individual') : 'Conjunta'}
                        {account.numberMasked ? ` · ${account.numberMasked}` : ''}
                        {account.balanceSyncedAt
                          ? ` · saldo de ${formatDate(account.balanceSyncedAt.slice(0, 10))}`
                          : ''}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-sm font-semibold tabular-nums"
                      style={{
                        color: account.currentBalanceCents < 0 ? 'var(--value-down)' : 'var(--ink-primary)',
                      }}
                    >
                      {formatCents(account.currentBalanceCents)}
                    </span>
                    {canWrite ? (
                      <RowActions
                        onEdit={() => {
                          setEditing(account);
                          setForm('account');
                        }}
                        onRemove={() => void removeAccount(account)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Cartões de crédito"
              action={
                canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setForm('card');
                    }}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white"
                  >
                    + Novo cartão
                  </button>
                ) : null
              }
            />

            {cards.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Nenhum cartão cadastrado.</p>
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {cards.map((card) => {
                  const statement = card.statements[0];
                  return (
                    <li key={card.id} className="flex items-center gap-3 py-3">
                      <span
                        aria-hidden
                        className="h-9 w-1 shrink-0 rounded-full"
                        style={{ background: card.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-primary">
                          {card.name}
                          {card.last4 ? (
                            <span className="ml-1.5 text-xs font-normal text-ink-muted">
                              ••••{card.last4}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-ink-muted">
                          Fecha dia {card.closingDay} · vence dia {card.dueDay}
                          {card.paymentAccount ? ` · debita de ${card.paymentAccount.name}` : ''}
                        </p>
                      </div>
                      {statement ? (
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-ink-primary">
                            {formatCents(Math.abs(statement.totalAmountCents))}
                          </p>
                          {statement.status === 'overdue' ? (
                            <Badge tone="critical">
                              <span aria-hidden className="mr-1">!</span>atrasada
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                      {canWrite ? (
                        <RowActions
                          onEdit={() => {
                            setEditing(card);
                            setForm('card');
                          }}
                          onRemove={() => void removeCard(card)}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {form === 'account' ? (
        <AccountForm
          account={editing as Account | null}
          members={members}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void reload();
          }}
        />
      ) : null}

      {form === 'card' ? (
        <CardForm
          card={editing as CreditCard | null}
          members={members}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RowActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={onEdit}
        aria-label="Editar"
        className="rounded-md border border-[var(--hairline)] px-2 py-1 text-xs text-ink-secondary hover:text-ink-primary"
      >
        editar
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover"
        className="rounded-md border border-[var(--hairline)] px-2 py-1 text-xs text-ink-muted hover:text-[var(--status-critical)]"
      >
        remover
      </button>
    </div>
  );
}

// ─────────────────────────────── formulários ───────────────────────────────

function AccountForm({
  account,
  members,
  onClose,
  onSaved,
}: {
  account: Account | null;
  members: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'checking');
  const [ownerUserId, setOwnerUserId] = useState(account?.ownerUserId ?? '');
  const [institutionName, setInstitutionName] = useState(account?.institutionName ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [balance, setBalance] = useState(
    account ? (account.currentBalanceCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: AccountInput = {
      name,
      type,
      ownerUserId: ownerUserId || null,
      ...(institutionName ? { institutionName } : {}),
      // Campo em branco na edição = manter o número atual (que o cliente não tem).
      ...(accountNumber ? { accountNumber } : {}),
      ...(balance ? { currentBalanceCents: parseToCents(balance) } : {}),
    };

    try {
      if (account) await api.updateAccount(account.id, payload);
      else await api.createAccount(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <TextField label="Nome" id="acc-name" value={name} onChange={setName} required />

        <SelectField
          label="Tipo"
          id="acc-type"
          value={type}
          onChange={(v) => setType(v as Account['type'])}
          options={ACCOUNT_TYPES}
        />

        <SelectField
          label="De quem é"
          id="acc-owner"
          value={ownerUserId}
          onChange={setOwnerUserId}
          options={[
            { value: '', label: 'Conjunta (do casal)' },
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />

        <TextField
          label="Banco (opcional)"
          id="acc-bank"
          value={institutionName}
          onChange={setInstitutionName}
          placeholder="Nubank, Itaú…"
        />

        <TextField
          label="Número da conta (opcional)"
          id="acc-number"
          value={accountNumber}
          onChange={setAccountNumber}
          placeholder={account?.numberMasked ?? '00000-0'}
          hint={
            account?.numberMasked
              ? 'Deixe em branco para manter o número atual. Ele é guardado criptografado.'
              : 'Guardado criptografado; a tela só mostra os 4 últimos dígitos.'
          }
        />

        <TextField
          label="Saldo atual"
          id="acc-balance"
          value={balance}
          onChange={setBalance}
          placeholder="0,00"
          hint="A importação de extrato sobrescreve este valor quando o banco informa o saldo."
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

function CardForm({
  card,
  members,
  accounts,
  onClose,
  onSaved,
}: {
  card: CreditCard | null;
  members: Array<{ id: string; name: string }>;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(card?.name ?? '');
  const [brand, setBrand] = useState<CreditCard['brand']>(card?.brand ?? 'other');
  const [ownerUserId, setOwnerUserId] = useState(card?.ownerUserId ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState(card?.paymentAccountId ?? '');
  const [last4, setLast4] = useState(card?.last4 ?? '');
  const [limit, setLimit] = useState(
    card?.creditLimitCents ? (card.creditLimitCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [closingDay, setClosingDay] = useState(String(card?.closingDay ?? 28));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: CardInput = {
      name,
      brand,
      ownerUserId: ownerUserId || null,
      paymentAccountId: paymentAccountId || null,
      ...(last4 ? { last4 } : {}),
      creditLimitCents: limit ? parseToCents(limit) : null,
      closingDay: Number(closingDay),
      dueDay: Number(dueDay),
    };

    try {
      if (card) await api.updateCard(card.id, payload);
      else await api.createCard(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={card ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <TextField label="Nome" id="card-name" value={name} onChange={setName} required />

        <SelectField
          label="Bandeira"
          id="card-brand"
          value={brand}
          onChange={(v) => setBrand(v as CreditCard['brand'])}
          options={BRANDS}
        />

        <SelectField
          label="De quem é"
          id="card-owner"
          value={ownerUserId}
          onChange={setOwnerUserId}
          options={[
            { value: '', label: 'Conjunto (do casal)' },
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />

        <TextField
          label="4 últimos dígitos (opcional)"
          id="card-last4"
          value={last4}
          onChange={(v) => setLast4(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="1234"
          hint="Só os 4 últimos. Nunca peça nem guarde o número completo ou o CVV."
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Dia de fechamento"
            id="card-closing"
            value={closingDay}
            onChange={(v) => setClosingDay(v.replace(/\D/g, '').slice(0, 2))}
            required
          />
          <TextField
            label="Dia de vencimento"
            id="card-due"
            value={dueDay}
            onChange={(v) => setDueDay(v.replace(/\D/g, '').slice(0, 2))}
            required
          />
        </div>

        <TextField
          label="Limite (opcional)"
          id="card-limit"
          value={limit}
          onChange={setLimit}
          placeholder="0,00"
        />

        <SelectField
          label="Fatura debita de"
          id="card-payment"
          value={paymentAccountId}
          onChange={setPaymentAccountId}
          options={[
            { value: '', label: 'Não definido' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
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
