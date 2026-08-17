import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { conflict, unauthorized } from '../../lib/http-error.js';
import { signAccessToken } from '../../lib/jwt.js';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import { SYSTEM_CATEGORIES } from '../categories/system-categories.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  household: { id: string; name: string; role: string };
}

interface SessionContext {
  userAgent?: string;
  ip?: string;
}

/**
 * Cadastro.
 *
 * Usuário e household nascem na mesma transação: não existe estado "usuário sem
 * household". Isso elimina uma classe inteira de bug (`householdId` nulo em
 * middleware) e a tela de onboarding que ninguém quer manter.
 */
export async function register(input: {
  name: string;
  email: string;
  password: string;
  householdName?: string;
  ctx?: SessionContext;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Mensagem deliberadamente vaga: confirmar que o e-mail existe entrega uma
    // lista de clientes para quem estiver sondando.
    throw conflict('Não foi possível concluir o cadastro com esses dados.');
  }

  const passwordHash = await hashPassword(input.password);

  const { user, household } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name.trim(), email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    const household = await tx.household.create({
      data: {
        name: input.householdName?.trim() || `Finanças de ${input.name.split(' ')[0]}`,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true, name: true },
    });

    // O catálogo padrão é COPIADO para o household: assim o casal pode renomear
    // "Alimentação" para "Rango" sem afetar mais ninguém.
    await tx.category.createMany({
      data: SYSTEM_CATEGORIES.map((c) => ({
        householdId: household.id,
        name: c.name,
        slug: c.slug,
        kind: c.kind,
        color: c.color,
        icon: c.icon,
        isSystem: true,
      })),
    });

    return { user, household };
  });

  logger.info({ userId: user.id, householdId: household.id }, 'novo cadastro');

  const refreshToken = await issueRefreshToken(user.id, null, input.ctx);
  const accessToken = await signAccessToken({
    userId: user.id,
    householdId: household.id,
    role: 'owner',
  });

  return { accessToken, refreshToken, user, household: { ...household, role: 'owner' } };
}

export async function login(input: {
  email: string;
  password: string;
  ctx?: SessionContext;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      memberships: {
        orderBy: { joinedAt: 'asc' },
        take: 1,
        select: { householdId: true, role: true, household: { select: { name: true } } },
      },
    },
  });

  // Tempo constante: sem o hash falso, um e-mail inexistente responde em ~1 ms e
  // um existente em ~250 ms. Isso é um oráculo de enumeração medível com curl.
  if (!user) {
    await fakeVerify(input.password);
    throw unauthorized('E-mail ou senha incorretos.');
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw unauthorized('E-mail ou senha incorretos.');

  const membership = user.memberships[0];
  if (!membership) throw unauthorized('Usuário sem household associado.');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const refreshToken = await issueRefreshToken(user.id, null, input.ctx);
  const accessToken = await signAccessToken({
    userId: user.id,
    householdId: membership.householdId,
    role: membership.role,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    household: {
      id: membership.householdId,
      name: membership.household.name,
      role: membership.role,
    },
  };
}

/**
 * Rotação de refresh token com detecção de reuso.
 *
 * Cada refresh queima o token usado e emite outro na mesma família. Se um token
 * já revogado reaparece, só há duas explicações: cópia roubada ou race de rede.
 * Como não dá para distinguir as duas, tratamos como roubo e derrubamos a
 * família inteira — o legítimo faz login de novo, o atacante fica sem nada.
 */
export async function refresh(input: {
  refreshToken: string;
  ctx?: SessionContext;
}): Promise<AuthResult> {
  const tokenHash = hashToken(input.refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          memberships: {
            orderBy: { joinedAt: 'asc' },
            take: 1,
            select: { householdId: true, role: true, household: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!stored) throw unauthorized('Sessão inválida.');

  if (stored.revokedAt) {
    logger.warn(
      { userId: stored.userId, familyId: stored.familyId },
      'reuso de refresh token detectado — revogando família',
    );
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Sessão encerrada por segurança. Faça login novamente.');
  }

  if (stored.expiresAt < new Date()) throw unauthorized('Sessão expirada.');

  const membership = stored.user.memberships[0];
  if (!membership) throw unauthorized('Usuário sem household associado.');

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const newRefresh = await issueRefreshToken(stored.userId, stored.familyId, input.ctx);
  const accessToken = await signAccessToken({
    userId: stored.userId,
    householdId: membership.householdId,
    role: membership.role,
  });

  return {
    accessToken,
    refreshToken: newRefresh,
    user: { id: stored.user.id, name: stored.user.name, email: stored.user.email },
    household: {
      id: membership.householdId,
      name: membership.household.name,
      role: membership.role,
    },
  };
}

/** Logout: revoga a família inteira (todos os dispositivos daquele login). */
export async function logout(refreshToken: string): Promise<void> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    select: { familyId: true },
  });
  if (!stored) return; // idempotente: já estar deslogado não é erro

  await prisma.refreshToken.updateMany({
    where: { familyId: stored.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueRefreshToken(
  userId: string,
  familyId: string | null,
  ctx?: SessionContext,
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token), // o token em claro só existe no cookie
      familyId: familyId ?? crypto.randomUUID(),
      expiresAt,
      userAgent: ctx?.userAgent?.slice(0, 255) ?? null,
      ip: ctx?.ip ?? null,
    },
  });

  return token;
}
