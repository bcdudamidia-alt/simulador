import iconv from 'iconv-lite';
import { parseAmountToCents, type Cents } from '../../lib/money.js';

/**
 * Parser de OFX (Open Financial Exchange) — 1.x (SGML) e 2.x (XML).
 *
 * Por que um parser próprio em vez de uma lib de XML:
 *
 *  1. OFX 1.x NÃO é XML. Tags não fecham (`<DTPOSTED>20240115` e ponto final).
 *     Qualquer parser XML estrito rejeita o arquivo — e é esse o formato que
 *     99% dos bancos brasileiros exportam.
 *  2. Segurança: alimentar um XML de origem não confiável a um parser genérico
 *     abre XXE e billion-laughs. Aqui não há resolução de entidade nenhuma —
 *     declarações de DOCTYPE/ENTITY fazem o arquivo ser rejeitado de saída.
 *  3. Encoding: bancos brasileiros mandam cp1252/latin1 com header mentindo
 *     "UTF-8". Precisamos decidir o decode olhando os bytes, não o header.
 *
 * O parser é puro: bytes entram, dados normalizados saem. Nada de banco, nada
 * de I/O — o que o torna trivialmente testável (ver ofx-parser.test.ts).
 */

export interface OfxTransaction {
  /** TRNTYPE original do arquivo: DEBIT, CREDIT, PAYMENT, XFER… */
  trnType: string;
  /** DTPOSTED normalizado para YYYY-MM-DD no fuso do arquivo */
  postedAt: string;
  /** Valor em centavos. Negativo = saída. */
  amountCents: Cents;
  /** FITID — identificador único da transação no banco. Chave forte de dedupe. */
  fitid: string | null;
  /** MEMO e/ou NAME concatenados */
  description: string;
  /** CHECKNUM, quando houver */
  checkNumber: string | null;
  /** Contraparte, quando o banco informa (PIX costuma preencher) */
  payeeName: string | null;
}

export interface OfxStatement {
  kind: 'bank' | 'creditcard';
  currency: string;
  /** BANKID — código do banco (COMPE) */
  bankId: string | null;
  /** ACCTID — número da conta ou do cartão */
  accountId: string | null;
  /** ACCTTYPE — CHECKING, SAVINGS… */
  accountType: string | null;
  /** DTSTART / DTEND do período coberto */
  periodStart: string | null;
  periodEnd: string | null;
  /** LEDGERBAL — saldo final informado pelo banco */
  balanceCents: Cents | null;
  balanceDate: string | null;
  transactions: OfxTransaction[];
}

export interface OfxDocument {
  statements: OfxStatement[];
  /** Avisos não fatais: linhas puladas, campos ausentes. Vão para o error_log do batch. */
  warnings: string[];
}

export class OfxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfxParseError';
  }
}

// ───────────────────────────── encoding ─────────────────────────────

/**
 * Decide o encoding olhando os bytes, não confiando no header.
 *
 * Ordem: header explícito CHARSET → validade UTF-8 → cp1252 como fallback.
 * cp1252 é o fallback certo (e não latin1) porque cobre aspas curvas e travessão
 * que aparecem em memo de banco.
 */
export function decodeOfxBuffer(buffer: Buffer): string {
  const probe = buffer.subarray(0, 1024).toString('latin1');

  const charsetMatch = /CHARSET:\s*([\w-]+)/i.exec(probe);
  const encodingMatch = /ENCODING:\s*([\w-]+)/i.exec(probe);
  const xmlEncMatch = /encoding=["']([\w-]+)["']/i.exec(probe);

  const declared = (charsetMatch?.[1] ?? xmlEncMatch?.[1] ?? encodingMatch?.[1] ?? '').toUpperCase();

  const declaredIsLatin =
    declared === '1252' || declared === 'CP1252' || declared === 'WINDOWS-1252' ||
    declared === 'ISO-8859-1' || declared === 'LATIN1' || declared === 'USASCII';

  if (!declaredIsLatin && isValidUtf8(buffer)) {
    return buffer.toString('utf8').replace(/^﻿/, '');
  }
  return iconv.decode(buffer, 'win1252');
}

function isValidUtf8(buffer: Buffer): boolean {
  // O decoder do Node substitui byte inválido por U+FFFD. Se o round-trip não
  // volta idêntico, não era UTF-8 válido.
  const decoded = buffer.toString('utf8');
  if (decoded.includes('�')) return false;
  return Buffer.from(decoded, 'utf8').equals(buffer);
}

// ───────────────────────────── tokenização ─────────────────────────────

interface OfxNode {
  tag: string;
  value: string;
  children: OfxNode[];
}

const DANGEROUS = /<!(DOCTYPE|ENTITY)\b/i;

/**
 * Converte OFX (SGML ou XML) em árvore.
 *
 * Regra do SGML do OFX que faz tudo funcionar: uma tag é de agregação se o
 * próximo caractere não-branco depois dela for `<`; caso contrário, o texto até
 * a próxima tag é o valor dela e ela se fecha sozinha.
 */
function tokenize(content: string): OfxNode {
  if (DANGEROUS.test(content)) {
    throw new OfxParseError(
      'Arquivo contém declaração DOCTYPE/ENTITY e foi rejeitado (risco de XXE).',
    );
  }

  // Descarta o cabeçalho (`OFXHEADER:100…` ou `<?xml…?><?OFX…?>`) até o <OFX>.
  const start = content.search(/<OFX>/i);
  if (start === -1) {
    throw new OfxParseError('Não parece um arquivo OFX: tag <OFX> não encontrada.');
  }
  const body = content.slice(start);

  const root: OfxNode = { tag: 'ROOT', value: '', children: [] };
  const stack: OfxNode[] = [root];

  const tagRe = /<\/?([A-Za-z0-9._]+)>/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  /**
   * Última tag folha aberta, ainda esperando o seu valor.
   *
   * O valor pertence à FOLHA, não ao agregado que está no topo da pilha: em
   * `<STMTRS><CURDEF>BRL`, "BRL" é de CURDEF. Atribuir ao topo da pilha
   * colocaria o texto em STMTRS e todos os campos voltariam vazios.
   */
  let pendingLeaf: OfxNode | null = null;

  while ((match = tagRe.exec(body)) !== null) {
    const [full, rawTag] = match;
    const tag = rawTag!.toUpperCase();
    const isClosing = full[1] === '/';

    const text = body.slice(cursor, match.index).trim();
    cursor = match.index + full.length;

    if (text && pendingLeaf) {
      pendingLeaf.value = decodeEntities(text);
    }
    pendingLeaf = null;

    if (isClosing) {
      // Fecha até encontrar a tag correspondente. Tolerante a tags não fechadas
      // (o SGML do OFX faz isso o tempo todo).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const node: OfxNode = { tag, value: '', children: [] };
      stack[stack.length - 1]!.children.push(node);

      // Regra do SGML do OFX: a tag é de agregação quando o próximo caractere
      // não-branco depois dela é `<`. Caso contrário é folha, e o texto até a
      // próxima tag é o valor dela.
      if (/^\s*</.test(body.slice(cursor))) {
        stack.push(node);
      } else {
        pendingLeaf = node;
      }
    }
  }

  return root;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, '&'); // por último, para não desfazer os anteriores
}

function findAll(node: OfxNode, tag: string): OfxNode[] {
  const out: OfxNode[] = [];
  const walk = (n: OfxNode): void => {
    if (n.tag === tag) out.push(n);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

function findFirst(node: OfxNode, tag: string): OfxNode | null {
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const found = findFirst(child, tag);
    if (found) return found;
  }
  return null;
}

function text(node: OfxNode | null, tag: string): string | null {
  if (!node) return null;
  const found = findFirst(node, tag);
  const value = found?.value.trim();
  return value ? value : null;
}

// ───────────────────────────── datas ─────────────────────────────

/**
 * DTPOSTED do OFX: `YYYYMMDD`, `YYYYMMDDHHMMSS`, `YYYYMMDDHHMMSS.XXX[-3:BRT]`.
 *
 * Devolvemos a data como o banco a escreveu, sem converter fuso: converter
 * `20240131120000[-3:BRT]` para UTC moveria uma compra do dia 31 para o dia 1º
 * do mês seguinte, e o extrato passaria a divergir do app do banco.
 */
export function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;

  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Rejeita 31/02 e afins: Date normaliza em silêncio e a transação vai parar no mês errado.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  return `${y}-${mo}-${d}`;
}

// ───────────────────────────── parse ─────────────────────────────

export function parseOfx(input: Buffer | string): OfxDocument {
  const content = Buffer.isBuffer(input) ? decodeOfxBuffer(input) : input;
  const root = tokenize(content);
  const warnings: string[] = [];
  const statements: OfxStatement[] = [];

  // Conta corrente / poupança
  for (const stmt of findAll(root, 'STMTRS')) {
    statements.push(buildStatement(stmt, 'bank', warnings));
  }
  // Cartão de crédito
  for (const stmt of findAll(root, 'CCSTMTRS')) {
    statements.push(buildStatement(stmt, 'creditcard', warnings));
  }

  if (statements.length === 0) {
    const status = text(root, 'SEVERITY');
    const message = text(root, 'MESSAGE');
    throw new OfxParseError(
      status === 'ERROR' && message
        ? `O banco retornou um erro no arquivo: ${message}`
        : 'Nenhum extrato (STMTRS/CCSTMTRS) encontrado no arquivo OFX.',
    );
  }

  return { statements, warnings };
}

function buildStatement(
  node: OfxNode,
  kind: 'bank' | 'creditcard',
  warnings: string[],
): OfxStatement {
  const acctFrom = findFirst(node, kind === 'bank' ? 'BANKACCTFROM' : 'CCACCTFROM');
  const tranList = findFirst(node, 'BANKTRANLIST');
  const ledgerBal = findFirst(node, 'LEDGERBAL');

  const transactions: OfxTransaction[] = [];

  for (const [index, trn] of findAll(node, 'STMTTRN').entries()) {
    const postedAt = parseOfxDate(text(trn, 'DTPOSTED') ?? text(trn, 'DTUSER'));
    const rawAmount = text(trn, 'TRNAMT');

    if (!postedAt || rawAmount === null) {
      warnings.push(`Transação #${index + 1} ignorada: DTPOSTED ou TRNAMT ausente.`);
      continue;
    }

    let amountCents: Cents;
    try {
      amountCents = parseAmountToCents(rawAmount);
    } catch {
      warnings.push(`Transação #${index + 1} ignorada: valor inválido "${rawAmount}".`);
      continue;
    }

    if (amountCents === 0n) {
      warnings.push(`Transação #${index + 1} ignorada: valor zero.`);
      continue;
    }

    // MEMO e NAME frequentemente trazem metades diferentes da informação útil.
    const memo = text(trn, 'MEMO');
    const name = text(trn, 'NAME');
    const payee = text(findFirst(trn, 'PAYEE'), 'NAME');
    const description =
      [name, memo]
        .filter((v): v is string => Boolean(v))
        .filter((v, i, arr) => arr.indexOf(v) === i) // sem repetir quando NAME === MEMO
        .join(' · ') || 'Sem descrição';

    transactions.push({
      trnType: (text(trn, 'TRNTYPE') ?? 'OTHER').toUpperCase(),
      postedAt,
      amountCents,
      fitid: text(trn, 'FITID'),
      description,
      checkNumber: text(trn, 'CHECKNUM'),
      payeeName: payee ?? null,
    });
  }

  const balanceRaw = text(ledgerBal, 'BALAMT');
  let balanceCents: Cents | null = null;
  if (balanceRaw !== null) {
    try {
      balanceCents = parseAmountToCents(balanceRaw);
    } catch {
      warnings.push(`Saldo (LEDGERBAL) inválido: "${balanceRaw}".`);
    }
  }

  return {
    kind,
    currency: text(node, 'CURDEF') ?? 'BRL',
    bankId: text(acctFrom, 'BANKID'),
    accountId: text(acctFrom, 'ACCTID'),
    accountType: text(acctFrom, 'ACCTTYPE'),
    periodStart: parseOfxDate(text(tranList, 'DTSTART')),
    periodEnd: parseOfxDate(text(tranList, 'DTEND')),
    balanceCents,
    balanceDate: parseOfxDate(text(ledgerBal, 'DTASOF')),
    transactions,
  };
}
