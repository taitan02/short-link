import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  QUEUE_REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Jobs processed in parallel by this process. Each holds a DB connection for one short
  // transaction, so keep it below the Prisma pool size.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  // Raw click_events older than this are deleted; daily aggregates are kept.
  CLICK_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
});

export type Env = z.infer<typeof envSchema>;

// prettifyError reports paths and rules only, never the offending values (which may be secrets).
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
