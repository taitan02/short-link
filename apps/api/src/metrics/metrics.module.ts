import { Server } from 'node:http';
import {
  Global,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRegistry, startMetricsServer, stopServer } from '@short-link/observability';
import { Counter, Gauge, Histogram } from 'prom-client';
import { Env } from '../config/env';

@Injectable()
export class ApiMetrics {
  readonly registry = createRegistry('api');

  // Labelled by route template ("/:code"), never the raw URL, to keep cardinality bounded.
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route template and status',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly redirectCacheLookups = new Counter({
    name: 'redirect_cache_lookups_total',
    help: 'Redirect cache lookups by result (hit, miss, error)',
    labelNames: ['result'],
    registers: [this.registry],
  });

  readonly clickEnqueueFailures = new Counter({
    name: 'click_enqueue_failures_total',
    help: 'Click events dropped before reaching the queue, by reason (error, backlog_full)',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly clickEnqueuePending = new Gauge({
    name: 'click_enqueue_pending',
    help: 'Click events waiting for the queue to accept them (grows while Redis is unreachable)',
    registers: [this.registry],
  });

  readonly rateLimitStorageErrors = new Counter({
    name: 'rate_limit_storage_errors_total',
    help: 'Requests let through because rate-limit storage was unavailable',
    registers: [this.registry],
  });
}

@Injectable()
class MetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);
  private server?: Server;

  constructor(
    private readonly metrics: ApiMetrics,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap() {
    const port = this.config.get('METRICS_PORT', { infer: true });
    if (port === undefined) return;
    this.server = await startMetricsServer({ registry: this.metrics.registry, port });
    this.logger.log({ port }, 'Metrics server listening');
  }

  async onApplicationShutdown() {
    if (this.server) await stopServer(this.server);
  }
}

@Global()
@Module({
  providers: [ApiMetrics, MetricsServer],
  exports: [ApiMetrics],
})
export class MetricsModule {}
