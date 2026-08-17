import { createHash } from 'node:crypto';

/**
 * Normalização de descrição e extração de estabelecimento.
 *
 * "PAG*PADARIA BELA VISTA 08/12 SAO PAULO BR" e
 * "PAG*PADARIA BELA VISTA 15/12 SAO PAULO BR"
 * são o mesmo estabelecimento. Se não colapsarmos os dois no mesmo merchant, o
 * sistema nunca aprende e manda tudo para o LLM, todo mês, pagando de novo.
 *
 * Esta é a peça mais barata do pipeline e a que mais economiza: cada padrão
 * removido aqui é uma chamada de IA a menos para sempre.
 */

/** Prefixos de adquirente/gateway que não dizem nada sobre o estabelecimento. */
const ACQUIRER_PREFIXES = [
  'PAG*', 'PAGSEGURO*', 'PAGS*', 'MP*', 'MERCADOPAGO*', 'MERCPAGO*',
  'PICPAY*', 'STONE*', 'CIELO*', 'REDE*', 'GETNET*', 'SUMUP*', 'IUGU*',
  'IZ *', 'EBANX*', 'PAYPAL *', 'PP*', 'APPLE.COM/BILL', 'GOOGLE *',
];

/** Ruído estrutural de extrato brasileiro. */
const NOISE_PATTERNS: RegExp[] = [
  /\bCOMPRA\s+(NO\s+)?(DEBITO|CREDITO|CARTAO)\b/g,
  /\bCARTAO\s+(DE\s+)?(DEBITO|CREDITO)\b/g,
  /\bPAGAMENTO\s+(DE\s+)?(BOLETO|CONTA|FATURA)\b/g,
  /\bTRANSFERENCIA\s+(ENVIADA|RECEBIDA)\b/g,
  /\bPIX\s+(ENVIADO|RECEBIDO|QRS?|TRANSF)\b/g,
  /\bTED\b|\bDOC\b|\bTEF\b/g,
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g,        // datas embutidas
  /\b\d{2}:\d{2}(:\d{2})?\b/g,            // horas
  /\bPARC(ELA)?\s*\d{1,2}\s*\/\s*\d{1,2}\b/g,
  /\b\d{1,2}\s*\/\s*\d{1,2}\s*$/g,        // "03/12" no fim = parcela
  /\bNSU\s*\d+\b/gi,
  /\bAUT\s*\d+\b/gi,
  /\bDOC\.?\s*\d+\b/gi,
  /\bBR\s*$/g,                            // sufixo de país
  /\b\d{11,}\b/g,                         // CPF/CNPJ/ids longos
  /[*#]+/g,
];

/** Cidades que aparecem coladas no fim da descrição de cartão. */
const TRAILING_CITY = /\s+(SAO PAULO|RIO DE JANEIRO|BELO HORIZONTE|CURITIBA|PORTO ALEGRE|BRASILIA|SALVADOR|RECIFE|FORTALEZA|CAMPINAS|GUARULHOS)\s*$/;

export function normalizeDescription(raw: string): string {
  let s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

  for (const prefix of ACQUIRER_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }

  for (const pattern of NOISE_PATTERNS) {
    s = s.replace(pattern, ' ');
  }

  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(TRAILING_CITY, '').trim();
  s = s.replace(/[\s\-.,;:]+$/, '').trim();

  return s || raw.toUpperCase().trim();
}

/**
 * Nome de exibição do estabelecimento: "PADARIA BELA VISTA" → "Padaria Bela Vista".
 * Preposições ficam minúsculas; siglas de 2–3 letras (LTDA, ME, S/A) ficam como estão.
 */
export function toDisplayName(normalized: string): string {
  const lower = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'NA', 'NO']);
  const keepUpper = new Set(['LTDA', 'ME', 'SA', 'EPP', 'MEI', 'S/A', 'ITAU', 'BB']);

  return normalized
    .split(' ')
    .map((word, i) => {
      if (keepUpper.has(word)) return word;
      if (i > 0 && lower.has(word)) return word.toLowerCase();
      if (word.length <= 1) return word;
      return word[0]! + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Hash de deduplicação — fallback para quando o arquivo não traz FITID (o caso
 * normal de fatura em CSV).
 *
 * Inclui a origem de propósito: a mesma compra que aparece no extrato da conta
 * e na fatura do cartão são dois eventos distintos e devem coexistir.
 */
export function buildDedupeHash(input: {
  originId: string;
  postedAt: string;
  amountCents: bigint;
  normalizedDescription: string;
  /** Discriminador para o caso legítimo de duas transações idênticas no mesmo dia. */
  occurrence?: number;
}): string {
  const parts = [
    input.originId,
    input.postedAt,
    input.amountCents.toString(),
    input.normalizedDescription,
    String(input.occurrence ?? 0),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Detecta parcelamento: "NETSHOES 03/12", "PARCELA 3/12", "3 DE 12".
 * Roda ANTES da normalização, que apaga justamente esse padrão.
 */
export function extractInstallment(rawDescription: string): { number: number; total: number } | null {
  const patterns = [
    /\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*$/,
    /\b(\d{1,2})\s+DE\s+(\d{1,2})\s*$/i,
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(rawDescription);
    if (!m) continue;
    const number = Number(m[1]);
    const total = Number(m[2]);
    // 03/12 pode ser data. Só tratamos como parcela se fizer sentido como tal.
    if (total >= 2 && total <= 48 && number >= 1 && number <= total) {
      return { number, total };
    }
  }
  return null;
}
