import { z } from 'zod';

/**
 * Environment is validated at boot so a misconfigured deployment fails loudly
 * at start rather than at 2 a.m. in the middle of an approval (docs/03 §10).
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  AUTH_SECRET: z
    .string()
    .min(
      32,
      'AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 48`',
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  MEDIA_UPLOADS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const isTest = (): boolean => getEnv().NODE_ENV === 'test';
