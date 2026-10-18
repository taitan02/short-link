import { TestingModule } from '@nestjs/testing';
import { CLICK_JOB } from '@short-link/contracts';
import { PrismaService, ShortLink } from '@short-link/prisma';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ClickIngestService } from '../src/clicks/click-ingest.service';
import { testRedisUrl } from './test-env';
import { clickEvent, createLink, createWorker, resetDatabase, stats, waitForState } from './utils';

const totalClicks = async (prisma: PrismaService, shortLinkId: string) =>
  (await stats(prisma, shortLinkId)).find((row) => row.dimension === 'total')?.clicks ?? 0;

beforeAll(async () => {
  const redis = new Redis(testRedisUrl());
  await redis.flushdb();
  await redis.quit();
});

describe('ClickProcessor (e2e, real queue)', () => {
  let worker: TestingModule;
  let prisma: PrismaService;
  let clicks: Queue;
  let link: ShortLink;

  beforeAll(async () => {
    ({ worker, prisma, clicks } = await createWorker());
  });

  afterAll(async () => {
    await worker.close();
  });

  beforeEach(async () => {
    await resetDatabase(worker);
    link = await createLink(prisma);
  });

  it('processes a click job into raw event and aggregates', async () => {
    const event = clickEvent(link.id);
    const job = await clicks.add(CLICK_JOB, event, { jobId: event.eventId });

    await expect(waitForState(job, ['completed', 'failed'])).resolves.toBe('completed');
    const completed: unknown = (await clicks.getJob(job.id!))?.returnvalue;
    expect(completed).toBe('recorded');
    await expect(totalClicks(prisma, link.id)).resolves.toBe(1);
  });

  it('counts the same event once even when it arrives as two separate jobs', async () => {
    const event = clickEvent(link.id);
    const first = await clicks.add(CLICK_JOB, event, { jobId: `${event.eventId}-a` });
    const second = await clicks.add(CLICK_JOB, event, { jobId: `${event.eventId}-b` });

    await waitForState(first, ['completed']);
    await waitForState(second, ['completed']);
    await expect(totalClicks(prisma, link.id)).resolves.toBe(1);
  });

  it('fails a malformed payload immediately instead of burning retries', async () => {
    const job = await clicks.add(
      CLICK_JOB,
      { v: 1, eventId: 'not-a-uuid' },
      { attempts: 5, backoff: { type: 'fixed', delay: 10 } },
    );

    await expect(waitForState(job, ['completed', 'failed'])).resolves.toBe('failed');
    const failed = await clicks.getJob(job.id!);
    expect(failed?.attemptsMade).toBe(1);
    expect(failed?.failedReason).toMatch(/Invalid click payload/);
  });

  it('fails events for unknown links without retrying', async () => {
    const job = await clicks.add(CLICK_JOB, clickEvent('00000000-0000-7000-8000-000000000000'), {
      attempts: 5,
      backoff: { type: 'fixed', delay: 10 },
    });

    await expect(waitForState(job, ['completed', 'failed'])).resolves.toBe('failed');
    expect((await clicks.getJob(job.id!))?.attemptsMade).toBe(1);
  });
});

describe('ClickProcessor retries (e2e)', () => {
  let worker: TestingModule;
  let prisma: PrismaService;
  let clicks: Queue;
  let failuresLeft = 0;

  beforeAll(async () => {
    ({ worker, prisma, clicks } = await createWorker((builder) =>
      builder.overrideProvider(ClickIngestService).useFactory({
        inject: [PrismaService],
        factory: (db: PrismaService) => {
          const real = new ClickIngestService(db);
          return {
            ingest: (event: Parameters<ClickIngestService['ingest']>[0]) => {
              if (failuresLeft > 0) {
                failuresLeft--;
                return Promise.reject(new Error('simulated database blip'));
              }
              return real.ingest(event);
            },
          };
        },
      }),
    ));
  });

  afterAll(async () => {
    await worker.close();
  });

  it('retries a transient failure and still counts the click exactly once', async () => {
    await resetDatabase(worker);
    const link = await createLink(prisma);
    failuresLeft = 2;

    const job = await clicks.add(CLICK_JOB, clickEvent(link.id), {
      attempts: 5,
      backoff: { type: 'fixed', delay: 20 },
    });

    await expect(waitForState(job, ['completed', 'failed'])).resolves.toBe('completed');
    expect((await clicks.getJob(job.id!))?.attemptsMade).toBe(3);
    await expect(totalClicks(prisma, link.id)).resolves.toBe(1);
  });

  it('gives up after the configured attempts and keeps the job as failed', async () => {
    await resetDatabase(worker);
    const link = await createLink(prisma);
    failuresLeft = 10;

    const job = await clicks.add(CLICK_JOB, clickEvent(link.id), {
      attempts: 3,
      backoff: { type: 'fixed', delay: 20 },
    });

    await expect(waitForState(job, ['completed', 'failed'])).resolves.toBe('failed');
    expect((await clicks.getJob(job.id!))?.attemptsMade).toBe(3);
    await expect(totalClicks(prisma, link.id)).resolves.toBe(0);
    failuresLeft = 0;
  });
});

describe('Graceful shutdown (e2e)', () => {
  it('finishes the job in flight before closing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const isActive = new Promise<void>((resolve) => {
      started = resolve;
    });

    const { worker, prisma, clicks } = await createWorker((builder) =>
      builder.overrideProvider(ClickIngestService).useFactory({
        inject: [PrismaService],
        factory: (db: PrismaService) => {
          const real = new ClickIngestService(db);
          return {
            ingest: async (event: Parameters<ClickIngestService['ingest']>[0]) => {
              started();
              await gate;
              return real.ingest(event);
            },
          };
        },
      }),
    );
    await resetDatabase(worker);
    const link = await createLink(prisma);

    const job = await clicks.add(CLICK_JOB, clickEvent(link.id));
    await isActive;

    const closing = worker.close();
    // The job is still mid-flight; close() must wait for it rather than abandon it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await closing;

    const observer = new Queue(clicks.name, { connection: { url: testRedisUrl() } });
    const after = await observer.getJob(job.id!);
    expect(await after?.getState()).toBe('completed');
    await observer.close();

    const checker = await createWorker();
    await expect(totalClicks(checker.prisma, link.id)).resolves.toBe(1);
    await checker.worker.close();
  });
});
