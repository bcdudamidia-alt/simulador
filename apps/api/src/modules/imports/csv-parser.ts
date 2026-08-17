import iconv from 'iconv-lite';
import { parseAmountToCents, type Cents } from '../../lib/money.js';

/**
 * Parser de CSV de extrato/fatura.
 *
 * Não existe "o" formato de CSV bancário: cada banco inventa o seu. Em vez de
 * pedir ao usuário que mapeie colunas na mão, detectamos o cabeçalho por
 * sinônimos conhecidos e só pedimos ajuda quando a detecção falha.
 *
 * Também detectamos o delimitador (`,` `;` `\t`) — CSV brasileiro exportado do
 * Excel usa `;`, porque a vírgula já é o separador decimal.
 */

export interface CsvRow {
  postedAt: string;
  amountCents: Cents;
  description: string;
  raw: Record<string, string>;
}

export interface CsvParseResult {
  rows: CsvRow[];
  warnings: string[];
  /** Mapeamento que a detecção escolheu — devolvido ao frontend para confirmação. */
  columnMapping: { date: string; amount: string; description: string; credit?: string };
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const SYNONYMS = {
  date: ['data', 'data lancamento', 'data do lancamento', 'data movimento', 'date', 'dt', 'data compra'],
  amount: ['valor', 'valor (r$)', 'montante', 'amount', 'value', 'quantia', 'valor lancamento'],
  description: [
    'descricao', 'descrição', 'historico', 'histórico', 'lancamento', 'lançamento',
    'description', 'memo', 'estabelecimento', 'detalhes', 'titulo',
  ],
  // Layout débito/crédito em colunas separadas
  debit: ['debito', 'débito', 'saida', 'saída', 'debit'],
  credit: ['credito', 'crédito', 'entrada', 'credit'],
} as const;

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["']/g, '')
    .trim()
    .toLowerCase();
}

function detectDelimiter(firstLine: string): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/** Split de linha CSV respeitando aspas e aspas escapadas (`""`). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Datas de CSV brasileiro: dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd. */
export function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (br) {
    const day = br[1]!.padStart(2, '0');
    const month = br[2]!.padStart(2, '0');
    let year = br[3]!;
    if (year.length === 2) year = `20${year}`;
    if (Number(month) > 12) return null; // mm/dd não é assumido: melhor falhar do que inverter em silêncio
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function parseCsv(input: Buffer | string): CsvParseResult {
  const content = Buffer.isBuffer(input) ? decodeCsvBuffer(input) : input;
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (lines.length < 2) {
    throw new CsvParseError('Arquivo CSV vazio ou sem linhas de dados.');
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitCsvLine(lines[0]!, delimiter).map(normalizeHeader);

  const find = (list: readonly string[]): number =>
    headers.findIndex((h) => list.some((syn) => h === syn || h.includes(syn)));

  const dateIdx = find(SYNONYMS.date);
  const descIdx = find(SYNONYMS.description);
  let amountIdx = find(SYNONYMS.amount);
  const debitIdx = find(SYNONYMS.debit);
  const creditIdx = find(SYNONYMS.credit);

  const hasSplitColumns = amountIdx === -1 && debitIdx !== -1 && creditIdx !== -1;

  if (dateIdx === -1 || descIdx === -1 || (amountIdx === -1 && !hasSplitColumns)) {
    throw new CsvParseError(
      `Não foi possível identificar as colunas do CSV. Cabeçalho lido: [${headers.join(', ')}]. ` +
        'Esperado: uma coluna de data, uma de descrição e uma de valor (ou débito + crédito).',
    );
  }

  const warnings: string[] = [];
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!, delimiter);
    const lineNo = i + 1;

    const postedAt = parseCsvDate(cells[dateIdx] ?? '');
    if (!postedAt) {
      // Rodapés de "Total"/"Saldo final" caem aqui e devem ser pulados em silêncio.
      warnings.push(`Linha ${lineNo} ignorada: data inválida ("${cells[dateIdx] ?? ''}").`);
      continue;
    }

    let amountCents: Cents;
    try {
      if (hasSplitColumns) {
        const debit = cells[debitIdx]?.trim();
        const credit = cells[creditIdx]?.trim();
        if (credit) {
          amountCents = parseAmountToCents(credit);
          if (amountCents < 0n) amountCents = -amountCents; // crédito é sempre entrada
        } else if (debit) {
          const v = parseAmountToCents(debit);
          amountCents = v > 0n ? -v : v; // débito é sempre saída
        } else {
          warnings.push(`Linha ${lineNo} ignorada: débito e crédito vazios.`);
          continue;
        }
      } else {
        amountCents = parseAmountToCents(cells[amountIdx] ?? '');
      }
    } catch {
      warnings.push(`Linha ${lineNo} ignorada: valor inválido ("${cells[amountIdx] ?? ''}").`);
      continue;
    }

    if (amountCents === 0n) {
      warnings.push(`Linha ${lineNo} ignorada: valor zero.`);
      continue;
    }

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = cells[idx] ?? '';
    });

    rows.push({
      postedAt,
      amountCents,
      description: (cells[descIdx] ?? '').trim() || 'Sem descrição',
      raw,
    });
  }

  if (rows.length === 0) {
    throw new CsvParseError(
      `Nenhuma linha válida encontrada. Primeiros avisos: ${warnings.slice(0, 3).join(' ')}`,
    );
  }

  if (amountIdx === -1) amountIdx = debitIdx;

  return {
    rows,
    warnings,
    columnMapping: {
      date: headers[dateIdx]!,
      amount: headers[amountIdx]!,
      description: headers[descIdx]!,
      ...(hasSplitColumns ? { credit: headers[creditIdx]! } : {}),
    },
  };
}

function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�') && Buffer.from(utf8, 'utf8').equals(buffer)) {
    return utf8.replace(/^﻿/, '');
  }
  return iconv.decode(buffer, 'win1252');
}
