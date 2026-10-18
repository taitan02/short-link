import { Server } from 'node:http';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLICK_QUEUE } from '@short-link/contracts';
import { createRegistry, startMetricsServer, stopServer } from '@short-link/observability';
import { PrismaService } from '@short-link/prisma';
import { Queue } from 'bullmq';
import { Counter, Gauge, Histogram } from 'prom-client';
import { Env } from './config/env';
import { MAINTENANCE_QUEUE } from './queues';

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
const CHECK_TIMEOUT_MS = 1_000;

@Injectable()
export class WorkerMetrics {
  readonly registry = createRegistry('analytics-worker');

  readonly clickJobs = new Counter({
    name: 'click_jobs_total',
    help: 'Click jobs by outcome (recorded, duplicate, retrying, failed)',
    labelNames: ['result'],
    registers: [this.registry],
  });

  readonly clickJobDuration = new Histogram({
    name: 'click_job_duration_seconds',
    help: 'Time to process one click job',
    buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1],
    registers: [this.registry],
  });

  readonly rawClicksPurged = new Counter({
    name: 'raw_clicks_purged_total',
    help: 'Raw click events deleted by the retention job',
    registers: [this.registry],
  });
}

function withTimeout(check: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    check.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
    }),
  ])
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}

@Injectable()
export class WorkerMetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerMetricsServer.name);
  private server?: Server;

  constructor(
    private readonly metrics: WorkerMetrics,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @InjectQueue(CLICK_QUEUE) private readonly clicks: Queue,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly maintenance: Queue,
  ) {
    const queues = [clicks, maintenance];
    // Read from Redis at scrape time, so the backlog is visible even if this worker is stuck.
    new Gauge({
      name: 'queue_jobs',
      help: 'Jobs per queue and state',
      labelNames: ['queue', 'state'],
      registers: [metrics.registry],
      async collect() {
        for (const queue of queues) {
          const counts = await queue.getJobCounts(...QUEUE_STATES);
          for (const state of QUEUE_STATES) {
            this.set({ queue: queue.name, state }, counts[state] ?? 0);
          }
        }
      },
    });
  }

  async onApplicationBootstrap() {
    const port = this.config.get('METRICS_PORT', { infer: true });
    if (port === undefined) return;
    this.server = await startMetricsServer({
      registry: this.metrics.registry,
      port,
      // Unlike the API, the worker can do nothing useful without either dependency.
      ready: async () => {
        const [database, redis] = await Promise.all([
          withTimeout(this.prisma.$queryRaw`SELECT 1`),
          // Cheapest round-trip BullMQ 6 exposes without reaching into its backend.
          withTimeout(this.clicks.getJobCounts('waiting')),
        ]);
        return database && redis;
      },
    });
    this.logger.log({ port }, 'Metrics server listening');
  }

  async onApplicationShutdown() {
    if (this.server) await stopServer(this.server);
  }
}
