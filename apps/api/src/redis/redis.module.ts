import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env';

export const REDIS = Symbol('REDIS');

// Redis is an optimization here (cache, rate-limit counters), never the source of truth, so
// every command fails fast rather than waiting: callers fall back to PostgreSQL or fail open.
const COMMAND_TIMEOUT_MS = 200;

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.get('REDIS_URL', { infer: true }), {
          commandTimeout: COMMAND_TIMEOUT_MS,
          connectTimeout: 2_000,
          // Without these, commands issued while disconnected are queued and retried, so a
          // Redis outage turns into slow requests instead of an immediate DB fallback.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        // Reconnection is automatic; without a listener ioredis prints unhandled error events.
        redis.on('error', (err: Error) => logger.warn({ err }, 'Redis connection error'));
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
