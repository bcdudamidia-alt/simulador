import bcrypt from 'bcrypt';

/**
 * bcrypt com cost 12.
 *
 * 12 é o ponto de equilíbrio atual: ~250 ms em hardware de servidor de 2025 —
 * caro o bastante para inviabilizar brute force offline, barato o bastante para
 * não virar vetor de DoS no endpoint de login (que também tem rate limit).
 *
 * bcrypt trunca em 72 bytes. Rejeitamos senhas acima disso em vez de deixar
 * passar: caso contrário, dois usuários com prefixo de 72 bytes igual teriam
 * senhas intercambiáveis.
 */
const COST = 12;
const MAX_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_BYTES) {
    throw new Error('Senha excede o limite de 72 bytes.');
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_BYTES) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Sem isso, o login responde na hora para e-mail inexistente e em ~250 ms para
 * e-mail existente — um oráculo de enumeração de usuários medido só com
 * cronômetro. Comparar contra um hash real iguala os tempos.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.eS3.LKq0hHNlAxIhIhkA0Uj7Y5NyHXi';

export async function fakeVerify(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH).catch(() => false);
}
