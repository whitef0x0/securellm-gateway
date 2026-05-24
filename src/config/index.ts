import { z } from 'zod';

// Single validated source of configuration. The rest of the app reads from here,
// never from process.env directly (enforced by the no-process-env lint rule).
// Required secrets/datastore vars are added to this schema as their chunks land.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  BODY_SIZE_LIMIT: z.string().default('4mb'),
  MONGO_URI: z.string().url().default('mongodb://localhost:27017/securellm'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_PSEUDONYM_SECRET: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().min(44), // 32 bytes base64 = 44 chars
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  AUDIT_LOG_TTL_DAYS: z.coerce.number().int().positive().default(90),
  PII_VAULT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}
