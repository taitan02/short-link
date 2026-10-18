import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CLICK_QUEUE } from '@short-link/contracts';
import { PrismaModule } from '@short-link/prisma';
import { LoggerModule } from 'nestjs-pino';
import { ClickIngestService } from './clicks/click-ingest.service';
import { ClickProcessor } from './clicks/click.processor';
import { Env, validateEnv } from './config/env';
import { WorkerMetrics, WorkerMetricsServer } from './metrics';
import { MAINTENANCE_QUEUE } from './queues';
import { RetentionProcessor, RetentionService } from './retention/retention.processor';

@Module({
  imports: [
    // .env files are loaded by the dev script, never by the app (same rule as the API).
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
        },
      }),
    }),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        url: config.get('DATABASE_URL', { infer: true }),
        // One connection per concurrent job, plus headroom for retention and readiness checks.
        // A smaller pool makes jobs queue for connections and time out under load.
        poolMax: config.get('WORKER_CONCURRENCY', { infer: true }) + 2,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // Bound first: inside BullMQ's loosely typed options, get() would infer `any`.
        const url: string = config.get('QUEUE_REDIS_URL', { infer: true });
        // Consumer side: unlike the API, waiting out a Redis blip is the right behaviour here,
        // so commands queue while reconnecting. The backoff is capped at 2 s instead of BullMQ's
        // 20 s so the backlog starts draining right after an outage.
        return {
          connection: { url, retryStrategy: (times: number) => Math.min(times * 500, 2_000) },
        };
      },
    }),
    BullModule.registerQueue({ name: CLICK_QUEUE }, { name: MAINTENANCE_QUEUE }),
  ],
  providers: [
    ClickIngestService,
    ClickProcessor,
    RetentionService,
    RetentionProcessor,
    WorkerMetrics,
    WorkerMetricsServer,
  ],
})
export class WorkerModule {}
