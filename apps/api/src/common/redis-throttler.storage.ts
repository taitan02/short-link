import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { Counter } from 'prom-client';

// Fixed window per key, plus a separate block key once the limit is exceeded. One script so
// concurrent requests across API instances can't interleave between the INCR and the check.
// Fixed windows allow up to 2x the limit across a window boundary; acceptable for abuse
// prevention, not for billing-grade quotas.
const INCREMENT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, blockTtl, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    private readonly redis: Redis,
    private readonly errors: Counter,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    try {
      const result = await this.redis.eval(
        INCREMENT,
        2,
        `${base}:hits`,
        `${base}:block`,
        ttl,
        limit,
        blockDuration,
      );
      if (!Array.isArray(result) || result.length !== 4) {
        throw new Error('Unexpected rate limit script result');
      }
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = result.map(Number);
      return {
        totalHits: totalHits ?? 0,
        timeToExpire: toSeconds(timeToExpire ?? 0),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: toSeconds(timeToBlockExpire ?? 0),
      };
    } catch (error) {
      this.errors.inc();
      // Fail open: a Redis outage must not take redirects and the API down with it. Login stays
      // expensive to brute-force regardless, because every attempt costs an argon2 hash.
      this.logger.warn({ err: error }, 'Rate limit storage unavailable, allowing request');
      return { totalHits: 0, timeToExpire: toSeconds(ttl), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
