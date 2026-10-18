import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@short-link/prisma';
import { Queue } from 'bullmq';
import { Env } from '../config/env';

export const MAINTENANCE_QUEUE = 'analytics-maintenance';
const PURGE_JOB = 'purge-raw-clicks';
// Small batches keep each DELETE short, so it never holds locks or bloats WAL long enough to
// slow down concurrent click inserts.
const BATCH_SIZE = 5_000;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Deletes raw clicks past retention. Daily aggregates are untouched. */
  async purgeExpiredClicks(now = new Date(), batchSize = BATCH_SIZE): Promise<number> {
    const days = this.config.get('CLICK_RETENTION_DAYS', { infer: true });
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM click_events
        WHERE id IN (
          SELECT id FROM click_events WHERE clicked_at < ${cutoff} LIMIT ${batchSize}
        )`;
      total += deleted;
      if (deleted < batchSize) break;
    }
    this.logger.log({ deleted: total, cutoff }, 'Purged raw click events');
    return total;
  }
}

@Processor(MAINTENANCE_QUEUE)
export class RetentionProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly retention: RetentionService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  // Upsert is idempotent, so every worker replica can declare the schedule on boot; BullMQ
  // still produces one job per tick, picked up by whichever replica is free.
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      PURGE_JOB,
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: PURGE_JOB, opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
  }

  async process(): Promise<number> {
    return this.retention.purgeExpiredClicks();
  }
}
