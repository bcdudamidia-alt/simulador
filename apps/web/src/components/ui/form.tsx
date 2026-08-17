'use client';

import { useEffect, type InputHTMLAttributes, type ReactNode } from 'react';

/** Primitivos de formulário compartilhados pelas telas de cadastro. */

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  // Esc fecha. Diálogo sem saída pelo teclado é armadilha de acessibilidade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-auto rounded-xl border border-[var(--hairline)] bg-surface p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-ink-muted transition-colors hover:text-ink-primary"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TextField({
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
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
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

export function SelectField({
  label,
  id,
  value,
  onChange,
  options,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
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
        className="w-full rounded-lg border border-[var(--hairline)] bg-surface px-3 py-2 text-sm text-ink-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FormActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="submit"
        disabled={busy}
        className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-[var(--gridline)]"
      >
        Cancelar
      </button>
    </div>
  );
}

/**
 * "R$ 1.234,56" → 123456 centavos.
 *
 * Aceita a mesma bagunça que o usuário digita de verdade: com ou sem "R$", com
 * ponto de milhar, com vírgula ou ponto decimal. A conversão é feita em
 * inteiros no fim para não introduzir erro de float justamente no valor que
 * será persistido.
 */
export function parseToCents(input: string): number {
  const cleaned = input.trim().replace(/[R$\s]/gi, '');
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);

  // Menos de 3 dígitos após o separador ⇒ é decimal; 3 dígitos ⇒ é milhar.
  const isDecimal = decimalIndex >= 0 && cleaned.length - decimalIndex - 1 <= 2;

  const intPart = (isDecimal ? cleaned.slice(0, decimalIndex) : cleaned).replace(/[^\d-]/g, '');
  const fracPart = isDecimal
    ? cleaned.slice(decimalIndex + 1).replace(/\D/g, '').padEnd(2, '0').slice(0, 2)
    : '00';

  const negative = intPart.startsWith('-');
  const cents = Number(intPart.replace('-', '') || '0') * 100 + Number(fracPart);
  return negative ? -cents : cents;
}
