'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/**
 * Alternador de tema.
 *
 * Três estados, não dois: "sistema" é o padrão e precisa continuar existindo
 * depois que o usuário escolhe algo — senão não há como voltar a seguir o SO.
 * Em "sistema" o atributo `data-theme` é REMOVIDO, e o CSS cai no
 * `prefers-color-scheme`.
 *
 * O script anti-flash correspondente está em `layout.tsx`: sem ele, a página
 * renderiza clara por um frame antes do React hidratar — e um flash branco às
 * 23h é exatamente o que o modo escuro existe para evitar.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    setTheme((localStorage.getItem('pareo-theme') as Theme | null) ?? 'system');
  }, []);

  function apply(next: Theme): void {
    setTheme(next);
    localStorage.setItem('pareo-theme', next);
    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', next);
    }
  }

  const options: Array<{ value: Theme; icon: string; label: string }> = [
    { value: 'light', icon: '☀', label: 'Tema claro' },
    { value: 'dark', icon: '☾', label: 'Tema escuro' },
    { value: 'system', icon: '⌂', label: 'Seguir o sistema' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex items-center gap-0.5 rounded-lg border border-[var(--hairline)] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => apply(option.value)}
          className={`rounded-md px-2 py-1 text-xs transition-colors ${
            theme === option.value
              ? 'bg-[var(--gridline)] text-ink-primary'
              : 'text-ink-muted hover:text-ink-secondary'
          }`}
        >
          <span aria-hidden>{option.icon}</span>
        </button>
      ))}
    </div>
  );
}
