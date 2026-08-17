import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Criptografia de campo em repouso.
 *
 * Formato do blob persistido em `bytea`:
 *
 *   ┌────────┬───────────┬─────────────┬──────────────┐
 *   │ v (1B) │ IV (12B)  │ tag (16B)   │ ciphertext   │
 *   └────────┴───────────┴─────────────┴──────────────┘
 *
 * O byte de versão existe para permitir rotação de chave/algoritmo depois sem
 * migração big-bang: o decrypt olha a versão e escolhe o caminho.
 *
 * AES-256-GCM é autenticado — se alguém adulterar a linha no banco, o decrypt
 * lança em vez de devolver lixo silenciosamente.
 *
 * A chave vem de env no MVP. Em produção ela deve vir de KMS/Secret Manager, e o
 * ideal é envelope encryption (DEK por household cifrada por uma KEK do KMS);
 * `KEY_VERSION` já deixa o caminho aberto para isso.
 */

const KEY_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
const indexKey = Buffer.from(env.BLIND_INDEX_KEY, 'hex');

/**
 * Devolve `Uint8Array` e não `Buffer` porque é isso que o Prisma espera em
 * coluna `Bytes`. `Buffer` é `Uint8Array<ArrayBufferLike>` (o buffer subjacente
 * pode ser um `SharedArrayBuffer`), e o Prisma exige `Uint8Array<ArrayBuffer>`.
 * A cópia via construtor resolve isso e ainda desatrela o resultado do pool
 * interno do Node.
 */
export function encrypt(plaintext: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (plaintext == null || plaintext === '') return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return new Uint8Array(Buffer.concat([Buffer.from([KEY_VERSION]), iv, tag, ciphertext]));
}

export function decrypt(blob: Buffer | Uint8Array | null | undefined): string | null {
  if (blob == null) return null;

  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('crypto: blob cifrado truncado');
  }

  const version = buf[0];
  if (version !== KEY_VERSION) {
    throw new Error(`crypto: versão de chave desconhecida (${version})`);
  }

  const iv = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Blind index: HMAC determinístico que permite buscar por igualdade sem decifrar.
 *
 * Usado para casar o `<ACCTID>` que vem no arquivo OFX com a conta cadastrada.
 * Chave separada da de criptografia de propósito: vazar o índice não deve
 * ajudar a decifrar o dado.
 *
 * Limitação aceita conscientemente: como é determinístico, valores iguais geram
 * índices iguais. Isso é aceitável para número de conta (alta entropia); NÃO
 * seria aceitável para algo como CPF em base grande, onde o dicionário é
 * enumerável — nesse caso o certo é HMAC truncado + bucket.
 */
export function blindIndex(value: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (value == null || value === '') return null;
  const normalized = value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return new Uint8Array(createHmac('sha256', indexKey).update(normalized).digest());
}

/** Hash de token opaco (refresh, convite). Barato de propósito: o token já tem 256 bits de entropia. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token opaco de 256 bits, url-safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 de arquivo — chave de idempotência da importação. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Comparação em tempo constante para strings de mesmo propósito (hashes, tokens). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
