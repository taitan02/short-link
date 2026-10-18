import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CLICK_JOB, CLICK_QUEUE, ClickEventV1, MAX_USER_AGENT_LENGTH } from '@short-link/contracts';
import { Queue } from 'bullmq';
import { waitBriefly } from '../common/wait-briefly';

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
 * Delivery policy: best effort. The redirect never waits for the queue, and if Redis rejects the
 * job (outage, or not yet connected after a restart) the click is logged and dropped rather than
 * buffered in process memory, where a crash would lose it anyway. Once enqueued, processing is
 * at-least-once with idempotent writes, so retries do not double count.
 */
@Injectable()
export class ClickRecorder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClickRecorder.name);

  constructor(@InjectQueue(CLICK_QUEUE) private readonly queue: Queue<ClickEventV1>) {}

  async onApplicationBootstrap() {
    await waitBriefly(this.queue.waitUntilReady(), 2_000);
  }

  record(context: ClickContext): void {
    const event: ClickEventV1 = {
      v: 1,
      eventId: randomUUID(),
      shortLinkId: context.shortLinkId,
      clickedAt: new Date().toISOString(),
      referrerHost: referrerHost(context.referer),
      userAgent: context.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    };

    // jobId = eventId: BullMQ ignores a second add with the same id while the first job exists.
    this.queue.add(CLICK_JOB, event, { jobId: event.eventId }).catch((error: unknown) => {
      this.logger.warn(
        { err: error, shortLinkId: event.shortLinkId },
        'Click event dropped: enqueue failed',
      );
    });
  }
}
