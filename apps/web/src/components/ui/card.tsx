import type { ReactNode } from 'react';

/** Superfície padrão: hairline + raio, sem sombra. A hierarquia vem do plano de fundo. */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag
      className={`rounded-xl border border-[var(--hairline)] bg-surface p-5 ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Legenda. Presente sempre que houver 2+ séries — identidade nunca pode
 * depender só da cor, e o rótulo direto complementa, não substitui.
 */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Selo de estado. Sempre texto + cor, nunca cor sozinha. */
export function Badge({
  tone,
  children,
}: {
  tone: 'good' | 'warning' | 'serious' | 'critical' | 'neutral';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    good: 'text-[var(--status-good)] border-[var(--status-good)]',
    warning: 'text-[var(--status-warning)] border-[var(--status-warning)]',
    serious: 'text-[var(--status-serious)] border-[var(--status-serious)]',
    critical: 'text-[var(--status-critical)] border-[var(--status-critical)]',
    neutral: 'text-ink-secondary border-[var(--hairline)]',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
