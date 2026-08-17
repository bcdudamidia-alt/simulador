'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ThemeToggle } from '../../components/theme-toggle';

/**
 * Entrada: login e cadastro na mesma tela.
 *
 * Duas decisões que vêm direto do backend e não podem divergir dele:
 *
 *  1. A mensagem de erro do login é sempre a mesma ("e-mail ou senha
 *     incorretos"). Se a UI fosse mais "prestativa" e dissesse "esse e-mail não
 *     existe", desfaria a proteção contra enumeração que a API implementa com
 *     hash em tempo constante.
 *  2. A senha exige 12 caracteres e nada mais. Sem regra de maiúscula, número e
 *     símbolo — isso produz "Senha@123", que está em todo dicionário de ataque.
 */
export default function LoginPage() {
  const { status, login, enterDemo } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' || status === 'demo') router.replace('/');
  }, [status, router]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await api.register({
          name,
          email,
          password,
          ...(householdName ? { householdName } : {}),
        });
        // O register já devolve sessão válida; recarregamos para o provider
        // pegar o estado pelo refresh, em vez de duplicar a lógica aqui.
        window.location.href = '/';
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível concluir. Verifique sua conexão.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: 'var(--brand)' }}
            >
              P
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink-primary">Pareo</span>
          </div>
          <ThemeToggle />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </h1>
        <p className="mt-1 mb-6 text-sm text-ink-muted">
          {mode === 'login'
            ? 'As finanças de vocês dois, no mesmo lugar.'
            : 'Comece sozinho e convide seu par depois.'}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'register' ? (
            <Field
              label="Seu nome"
              id="name"
              value={name}
              onChange={setName}
              autoComplete="name"
              required
            />
          ) : null}

          <Field
            label="E-mail"
            id="email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />

          <Field
            label="Senha"
            id="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 12 : undefined}
            hint={mode === 'register' ? 'Mínimo de 12 caracteres. Frase longa vale mais que símbolo.' : undefined}
          />

          {mode === 'register' ? (
            <Field
              label="Nome da carteira (opcional)"
              id="household"
              value={householdName}
              onChange={setHouseholdName}
              placeholder="Casa da Ana e do Bruno"
            />
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-[var(--status-critical)] px-3 py-2 text-sm text-[var(--status-critical)]"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <div className="mt-6 space-y-3 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="text-ink-secondary underline-offset-4 hover:underline"
          >
            {mode === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
          </button>

          <p className="text-xs text-ink-muted">
            ou{' '}
            <button
              type="button"
              onClick={enterDemo}
              className="text-brand underline-offset-4 hover:underline"
            >
              ver uma demonstração
            </button>{' '}
            com dados fictícios
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  hint,
  ...props
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id'>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-secondary">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-lg border border-[var(--hairline)] bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
