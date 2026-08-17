import { z } from 'zod';

/**
 * Validação de ambiente com falha rápida.
 *
 * Um app financeiro que sobe com JWT_SECRET vazio é pior do que um app que não
 * sobe: ele aceita tokens forjados em silêncio. Por isso o processo morre aqui,
 * no boot, e não na primeira request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().url(),

  // Segredos: 32 bytes em hex (64 chars). Gerar com:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY precisa ser 32 bytes em hex (64 chars)'),
  BLIND_INDEX_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'BLIND_INDEX_KEY precisa ser 32 bytes em hex (64 chars)'),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional(),

  // IA. Sem chave, o pipeline de categorização simplesmente para no nível 2
  // (regras + histórico) em vez de quebrar.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[env] Configuração inválida:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/** IA só está de fato ligada se estiver habilitada E tiver chave. */
export const aiEnabled = env.AI_ENABLED && Boolean(env.ANTHROPIC_API_KEY);
