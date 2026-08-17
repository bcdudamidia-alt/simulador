/**
 * Formatação pt-BR.
 *
 * Tudo que chega da API está em CENTAVOS. A divisão por 100 acontece aqui e em
 * nenhum outro lugar — é a única fronteira onde dinheiro vira número decimal, o
 * que impede que uma soma de floats apareça em algum componente.
 */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatCents = (cents: number): string => brl.format(cents / 100);

/** Para eixos e tiles: R$ 12,4 mil em vez de R$ 12.428,90. */
export const formatCentsCompact = (cents: number): string =>
  Math.abs(cents) >= 1_000_00 ? brlCompact.format(cents / 100) : brl.format(cents / 100);

export const formatPct = (value: number, digits = 1): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits).replace('.', ',')}%`;

const monthNames = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

/** "2026-01" → "jan/26" */
export function formatMonthShort(isoMonth: string): string {
  const [year, month] = isoMonth.split('-');
  return `${monthNames[Number(month) - 1] ?? '?'}/${year?.slice(2) ?? ''}`;
}

/** "2026-01" → "janeiro de 2026" */
export function formatMonthLong(isoMonth: string): string {
  const [year, month] = isoMonth.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(date);
}

/** "2026-01-15" → "15 jan" */
export function formatDayShort(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day} ${monthNames[Number(month) - 1] ?? ''}`;
}

/** "2026-01-15" → "15/01/2026" */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** "faltam 8 meses" / "vence este mês" / "venceu há 2 meses" */
export function formatMonthsRemaining(months: number | null): string {
  if (months === null) return 'sem prazo definido';
  if (months === 0) return 'vence este mês';
  if (months === 1) return 'falta 1 mês';
  return `faltam ${months} meses`;
}

/** Cor semântica de um valor: entrada verde, saída vermelha, zero neutro. */
export function valueTone(cents: number): string {
  if (cents > 0) return 'text-[var(--value-up)]';
  if (cents < 0) return 'text-[var(--value-down)]';
  return 'text-ink-secondary';
}
