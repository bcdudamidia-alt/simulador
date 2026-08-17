/**
 * Dinheiro em centavos, sempre. Nunca `number` decimal, nunca `float`.
 *
 * O motivo é o de sempre: 0.1 + 0.2 === 0.30000000000000004. Em um app de
 * controle financeiro isso vira um saldo que não fecha e um usuário que
 * desinstala.
 */

export type Cents = bigint;

/**
 * `JSON.stringify` explode em BigInt. Como o Prisma devolve BigInt para toda
 * coluna de dinheiro, a alternativa seria mapear campo a campo em cada
 * controller — e esquecer um. Serializamos como number: centavos cabem com
 * folga em Number.MAX_SAFE_INTEGER (≈ 90 trilhões de reais).
 */
export function installBigIntJsonSerializer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function toJSON(this: bigint): number {
    const n = Number(this);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`money: valor fora do range seguro para JSON (${this.toString()})`);
    }
    return n;
  };
}

/**
 * Converte a string de valor de um OFX/CSV em centavos.
 *
 * Precisa aguentar o zoológico real de formatos brasileiros:
 *   "-1234.56"  "-1.234,56"  "1234,56"  "R$ 1.234,56"  "(1.234,56)"  "1234"
 */
export function parseAmountToCents(raw: string): Cents {
  let s = raw.trim();
  if (s === '') throw new Error('money: valor vazio');

  // Contábil: (1.234,56) significa negativo.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[R$\s ]/gi, '');

  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  // Decide qual é o separador decimal: o ÚLTIMO que aparecer entre . e ,
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep: '.' | ',' | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    // "1,234" é ambíguo: separador de milhar (padrão en) ou decimal (padrão pt).
    // 3 dígitos depois da vírgula ⇒ milhar; caso contrário, decimal.
    decimalSep = s.length - lastComma - 1 === 3 ? null : ',';
  } else if (lastDot >= 0) {
    decimalSep = s.length - lastDot - 1 === 3 ? null : '.';
  }

  let intPart: string;
  let fracPart: string;

  if (decimalSep === null) {
    intPart = s.replace(/[.,]/g, '');
    fracPart = '';
  } else {
    const idx = decimalSep === ',' ? lastComma : lastDot;
    intPart = s.slice(0, idx).replace(/[.,]/g, '');
    fracPart = s.slice(idx + 1).replace(/[.,]/g, '');
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`money: valor não numérico "${raw}"`);
  }

  // Arredonda no 3º decimal em vez de truncar (alguns CSVs trazem 3 casas).
  const frac2 =
    fracPart.length <= 2
      ? fracPart.padEnd(2, '0')
      : String(Math.round(Number(`0.${fracPart}`) * 100)).padStart(2, '0');

  const cents = BigInt(intPart || '0') * 100n + BigInt(frac2.slice(0, 2) || '0');
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

export function formatBRL(cents: Cents): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(cents) / 100,
  );
}

export const sumCents = (values: Cents[]): Cents => values.reduce((a, b) => a + b, 0n);
export const absCents = (v: Cents): Cents => (v < 0n ? -v : v);
