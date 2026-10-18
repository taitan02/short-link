import { z } from 'zod';

const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }).transform((url) => new URL(url).origin),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Upper bound on staleness if a cache write after an edit fails; see LinkCacheService.
  LINK_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),

  // HS256 is only as strong as the secret; 32+ chars of random data (openssl rand -base64 48).
  JWT_SECRET: z.string().min(32),
  // No refresh tokens yet, so this is also the window during which a leaked token stays usable.
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),

  // Number of reverse proxies in front of the app. Wrong values make every client share one
  // rate-limit bucket (too low) or let clients spoof their IP via X-Forwarded-For (too high).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Comma-separated browser origins allowed to call the API; empty disables CORS.
  CORS_ORIGINS: commaList.pipe(z.array(z.url())),
  // Comma-separated hostnames; subdomains are blocked too.
  BLOCKED_DESTINATION_HOSTS: commaList.transform((hosts) => hosts.map((h) => h.toLowerCase())),
});

export type Env = z.infer<typeof envSchema>;

// Fails fast at boot so a misconfigured container never starts serving traffic.
// prettifyError reports paths and rules only, never the offending values (which may be secrets).
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
