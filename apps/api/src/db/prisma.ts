import { PrismaClient } from '@prisma/client';
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Singleton do Prisma.
 *
 * `globalThis` evita esgotar o pool no dev com hot reload — cada recarga do tsx
 * criaria um client novo e o Postgres derrubaria a conexão por limite.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error', 'warn'] : ['error', 'warn'],
  });

if (!isProd) globalForPrisma.prisma = prisma;

/**
 * Executa `fn` dentro de uma transação com o household fixado na sessão do
 * Postgres, ativando as policies de RLS (sql/002_rls.sql).
 *
 * `SET LOCAL` é obrigatório aqui: com pool de conexões, um `SET` normal
 * vazaria o household de um casal para a próxima request de outro.
 */
export async function withHouseholdScope<T>(
  householdId: string,
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Parametrizado: householdId vem do JWT já validado, mas nunca interpolamos
    // string em SQL, nem quando "é seguro".
    await tx.$executeRaw`SELECT set_config('app.current_household', ${householdId}::text, true)`;
    return fn(tx);
  });
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('prisma desconectado');
}

void env; // mantém a validação de env acoplada ao boot do banco
