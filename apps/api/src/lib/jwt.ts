import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { unauthorized } from './http-error.js';

/**
 * Access token JWT de vida curta.
 *
 * Modelo de sessão:
 *   · access  — 15 min, HS256, guardado APENAS em memória no cliente.
 *   · refresh — 30 dias, token opaco em cookie httpOnly, rotativo, hash no banco.
 *
 * Access token em localStorage é o erro clássico: qualquer XSS o exfiltra e o
 * atacante fica com sessão válida. Em memória, um reload já o perde — e o
 * refresh em cookie httpOnly é invisível para JavaScript.
 *
 * O `householdId` vai no payload para o caminho comum, mas o middleware
 * `withHousehold` sempre reconfirma a associação no banco: um token de 15 min
 * emitido antes de alguém sair do household não pode continuar dando acesso.
 */

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'pareo';
const AUDIENCE = 'pareo-web';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  householdId: string;
  role: string;
}

export async function signAccessToken(input: {
  userId: string;
  householdId: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ householdId: input.householdId, role: input.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Lista explícita: sem isso, um token com alg "none" seria aceito.
      algorithms: ['HS256'],
    });

    if (typeof payload.sub !== 'string' || typeof payload.householdId !== 'string') {
      throw unauthorized('Token malformado.');
    }
    return payload as AccessTokenClaims;
  } catch {
    // Nunca detalhamos o motivo (expirado × assinatura inválida): isso ajuda
    // quem está sondando e não ajuda o usuário legítimo, que só precisa relogar.
    throw unauthorized('Sessão inválida ou expirada.');
  }
}
