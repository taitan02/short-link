import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { PrismaModule } from '@short-link/prisma';
import Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HttpShutdown } from './common/http-shutdown';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { AppThrottlerGuard } from './common/throttler.guard';
import { Env, validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { ApiMetrics, MetricsModule } from './metrics/metrics.module';
import { RedirectModule } from './redirect/redirect.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

// The header is client-controlled and ends up in every log line, so anything that could
// inject into logs or blow up their size is replaced with a fresh id.
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

@Module({
  imports: [
    // .env files are loaded by the dev script (node --env-file-if-exists), never by the app, so
    // tests and containers only ever see the environment they were explicitly given.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty' }
              : undefined,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Default serializers log all headers and the client IP; keep only what debugging needs.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        },
      }),
    }),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        url: config.get('DATABASE_URL', { infer: true }),
      }),
    }),
    MetricsModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // Bound first: inside BullMQ's loosely typed options, get() would infer `any`.
        const url: string = config.get('QUEUE_REDIS_URL', { infer: true });
        return {
          connection: {
            url,
            // Producer side: once connected, an enqueue fails immediately while Redis is down
            // instead of queueing in memory. (Before the first connect, BullMQ waits instead;
            // ClickRecorder caps how many clicks may wait.)
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            // BullMQ's default reconnect backoff grows to 20 s, so after a short outage clicks
            // kept being dropped for up to 20 s more (measured: docs/performance.md).
            retryStrategy: (times: number) => Math.min(times * 200, 1_000),
          },
        };
      },
    }),
    // Counters live in Redis so limits hold across API replicas.
    ThrottlerModule.forRootAsync({
      inject: [REDIS, ApiMetrics],
      useFactory: (redis: Redis, metrics: ApiMetrics) => ({
        throttlers: [{ name: 'default', ttl: minutes(1), limit: 300 }],
        storage: new RedisThrottlerStorage(redis, metrics.rateLimitStorageErrors),
      }),
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    LinksModule,
    AnalyticsModule,
    // Last: its GET /:code catch-all must not shadow other single-segment routes.
    RedirectModule,
  ],
  // Order matters: authentication first, so the throttler can key on the user.
  providers: [
    HttpShutdown,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
