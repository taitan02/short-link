import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLICK_JOB, CLICK_QUEUE, ClickEventV1, MAX_USER_AGENT_LENGTH } from '@short-link/contracts';
import { Queue } from 'bullmq';
import { waitBriefly } from '../common/wait-briefly';
import { Env } from '../config/env';
import { ApiMetrics } from '../metrics/metrics.module';

export interface ClickContext {
  shortLinkId: string;
  referer: string | undefined;
  userAgent: string | undefined;
}

function referrerHost(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const { protocol, hostname } = new URL(referer);
    return protocol === 'http:' || protocol === 'https:' ? hostname.slice(0, 255) : null;
  } catch {
    return null;
  }
}

/**
 * Delivery policy: best effort. The redirect never waits for the queue.
 *
 * While Redis is unreachable, BullMQ's add() neither resolves nor rejects: it waits for the
 * connection. Left alone, every click during an outage would become a pending promise, i.e. an
 * unbounded in-memory buffer. So pending enqueues are capped: up to CLICK_ENQUEUE_MAX_PENDING
 * wait (and are delivered late if Redis comes back), beyond that clicks are dropped and counted.
 * Pending clicks are lost if the process dies. Once enqueued, processing is at-least-once with
 * idempotent writes, so retries do not double count.
 */
@Injectable()
export class ClickRecorder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClickRecorder.name);
  private readonly maxPending: number;
  private pending = 0;
  private backlogFull = false;

  constructor(
    @InjectQueue(CLICK_QUEUE) private readonly queue: Queue<ClickEventV1>,
    private readonly metrics: ApiMetrics,
    config: ConfigService<Env, true>,
  ) {
    this.maxPending = config.get('CLICK_ENQUEUE_MAX_PENDING', { infer: true });
  }

  async onApplicationBootstrap() {
    await waitBriefly(this.queue.waitUntilReady(), 2_000);
  }

  record(context: ClickContext): void {
    if (this.pending >= this.maxPending) {
      this.metrics.clickEnqueueFailures.inc({ reason: 'backlog_full' });
      if (!this.backlogFull) {
        // Logged on the transition only; the counter carries the volume.
        this.backlogFull = true;
        this.logger.error({ pending: this.pending }, 'Click enqueue backlog full, dropping clicks');
      }
      return;
    }
    if (this.backlogFull) {
      this.backlogFull = false;
      this.logger.warn({ pending: this.pending }, 'Click enqueue backlog has room again');
    }

    const event: ClickEventV1 = {
      v: 1,
      eventId: randomUUID(),
      shortLinkId: context.shortLinkId,
      clickedAt: new Date().toISOString(),
      referrerHost: referrerHost(context.referer),
      userAgent: context.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    };

    this.pending++;
    this.metrics.clickEnqueuePending.set(this.pending);
    // jobId = eventId: BullMQ ignores a second add with the same id while the first job exists.
    this.queue
      .add(CLICK_JOB, event, { jobId: event.eventId })
      .catch((error: unknown) => {
        this.metrics.clickEnqueueFailures.inc({ reason: 'error' });
        this.logger.warn(
          { err: error, shortLinkId: event.shortLinkId },
          'Click event dropped: enqueue failed',
        );
      })
      .finally(() => {
        this.pending--;
        this.metrics.clickEnqueuePending.set(this.pending);
      });
  }
}
