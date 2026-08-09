import { z } from 'zod';

/**
 * Configuration is parsed once, at boot, through a Zod schema. A bad `PORT` or a malformed
 * `OLLAMA_BASE_URL` therefore kills the process immediately with a readable message rather
 * than surfacing as a mystery `NaN` or a failed fetch twenty minutes into a shift.
 */

export const APP_VERSION = '1.0.0';

const BooleanEnv = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === '') return undefined;
    const lowered = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
    ctx.addIssue({ code: 'custom', message: `Expected a boolean, received "${value}"` });
    return z.NEVER;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),

  /** SQLite file. `:memory:` is honoured, which is what the test harness uses. */
  DATABASE_PATH: z.string().min(1).default('./data/incident-board.db'),

  /** Seed the database on boot when it is empty. Never overwrites existing rows. */
  SEED_ON_BOOT: BooleanEnv.pipe(z.boolean().default(true)),

  /** Comma-separated list of allowed browser origins, or `*`. */
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  /* -------------------------------------------------------------- AI provider */

  /** Native Ollama on the host by default; the container build overrides the host part. */
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('llama3.2:3b'),

  /**
   * Hard ceiling on a single generation. A 3B model on CPU can take a while; anything past
   * this is treated as unreachable and the deterministic engine answers instead.
   */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),

  /** Set false to force the deterministic engine — used by CI and the mocked E2E run. */
  AI_ENABLED: BooleanEnv.pipe(z.boolean().default(true)),

  /** Generations per minute per client. Local inference is expensive; this stops a stampede. */
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(20),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema> & { version: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return { ...parsed.data, version: APP_VERSION };
}

export function corsOrigins(config: AppConfig): '*' | string[] {
  if (config.CORS_ORIGIN.trim() === '*') return '*';
  return config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
