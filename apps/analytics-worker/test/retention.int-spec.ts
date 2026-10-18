import { getQueueToken } from '@nestjs/bullmq';
import { TestingModule } from '@nestjs/testing';
import { PrismaService, ShortLink } from '@short-link/prisma';
import { Queue } from 'bullmq';
import { ClickIngestService } from '../src/clicks/click-ingest.service';
import { MAINTENANCE_QUEUE, RetentionService } from '../src/retention/retention.processor';
import { clickEvent, createLink, createWorker, resetDatabase, stats } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Raw click retention (integration)', () => {
  let worker: TestingModule;
  let prisma: PrismaService;
  let link: ShortLink;

  beforeAll(async () => {
    ({ worker, prisma } = await createWorker());
  });

  afterAll(async () => {
    await worker.close();
  });

  beforeEach(async () => {
    await resetDatabase(worker);
    link = await createLink(prisma);
  });

  it('deletes raw events past retention in batches and keeps aggregates', async () => {
    const ingest = worker.get(ClickIngestService);
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await ingest.ingest(
        clickEvent(link.id, { clickedAt: new Date(now - 100 * DAY_MS).toISOString() }),
      );
    }
    const recent = clickEvent(link.id, { clickedAt: new Date(now - 10 * DAY_MS).toISOString() });
    await ingest.ingest(recent);
    const aggregatesBefore = await stats(prisma, link.id);

    // Batch of 2 forces several DELETE rounds over the 5 expired rows.
    await expect(worker.get(RetentionService).purgeExpiredClicks(new Date(now), 2)).resolves.toBe(
      5,
    );

    await expect(prisma.clickEvent.findMany({ select: { id: true } })).resolves.toEqual([
      { id: recent.eventId },
    ]);
    await expect(stats(prisma, link.id)).resolves.toEqual(aggregatesBefore);
  });

  it('registers a daily purge schedule in UTC', async () => {
    const maintenance = worker.get<Queue>(getQueueToken(MAINTENANCE_QUEUE));
    const schedulers = await maintenance.getJobSchedulers();

    expect(schedulers).toEqual([
      expect.objectContaining({ key: 'purge-raw-clicks', pattern: '0 3 * * *', tz: 'UTC' }),
    ]);
  });
});
