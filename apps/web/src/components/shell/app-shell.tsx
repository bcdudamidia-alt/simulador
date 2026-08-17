'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../../lib/session';
import { ThemeToggle } from '../theme-toggle';

/**
 * Shell autenticado: navegação lateral + barra superior.
 *
 * O guard vive aqui, e não em middleware do Next: a sessão depende de um token
 * em memória no browser, então o servidor não tem como saber se o usuário está
 * logado. Isso é consequência direta da escolha de não gravar credencial em
 * cookie legível — e é o trade-off certo, porque a API valida tudo de novo a
 * cada request. O guard do cliente é conveniência de navegação, nunca a
 * fronteira de segurança.
 */

const NAV = [
  { href: '/', label: 'Painel', icon: '◧' },
  { href: '/transacoes', label: 'Lançamentos', icon: '≡' },
  { href: '/importar', label: 'Importar', icon: '↑' },
  { href: '/contas', label: 'Contas e cartões', icon: '▤' },
  { href: '/metas', label: 'Metas', icon: '◎' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, household, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-muted" role="status">
          Carregando…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Barra superior (mobile) */}
      <header className="flex items-center justify-between border-b border-[var(--hairline)] bg-surface px-4 py-3 lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink-primary">
          <Logo />
          Pareo
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Menu"
          className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-sm text-ink-secondary"
        >
          ☰
        </button>
      </header>

      <aside
        className={`${menuOpen ? 'block' : 'hidden'} border-b border-[var(--hairline)] bg-surface px-3 py-4 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0`}
      >
        <Link
          href="/"
          className="mb-6 hidden items-center gap-2 px-2 text-lg font-semibold tracking-tight text-ink-primary lg:flex"
        >
          <Logo />
          Pareo
        </Link>

        <nav aria-label="Navegação principal">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-[var(--gridline)] font-medium text-ink-primary'
                        : 'text-ink-secondary hover:bg-[var(--gridline)] hover:text-ink-primary'
                    }`}
                  >
                    <span aria-hidden className="w-4 text-center text-ink-muted">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6 border-t border-[var(--hairline)] pt-4">
          <p className="px-3 text-xs font-medium text-ink-primary">{household?.name}</p>
          <p className="px-3 text-xs text-ink-muted">{user?.name}</p>

          <div className="mt-3 flex items-center justify-between gap-2 px-1">
            <ThemeToggle />
            {status === 'demo' ? (
              <Link
                href="/login"
                className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-xs text-ink-secondary hover:text-ink-primary"
              >
                Entrar
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:text-ink-primary"
              >
                Sair
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {status === 'demo' ? (
          <p className="border-b border-[var(--status-warning)] bg-surface px-4 py-2 text-center text-xs text-ink-secondary">
            <strong className="font-medium text-[var(--status-warning)]">
              Modo demonstração
            </strong>{' '}
            — números fictícios, nada é salvo.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white"
      style={{ background: 'var(--brand)' }}
    >
      P
    </span>
  );
}
