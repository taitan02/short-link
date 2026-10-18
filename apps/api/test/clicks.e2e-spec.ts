import { getQueueToken } from '@nestjs/bullmq';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CLICK_JOB, CLICK_QUEUE, ClickEventV1, clickEventV1 } from '@short-link/contracts';
import { PrismaService, User } from '@short-link/prisma';
import { Job, Queue } from 'bullmq';
import request from 'supertest';
import { createLink, createTestApp, createUser, resetState } from './utils';

describe('Click events (e2e, producer side)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: Queue<ClickEventV1>;
  let user: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    queue = app.get<Queue<ClickEventV1>>(getQueueToken(CLICK_QUEUE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    user = await createUser(prisma);
  });

  // Enqueueing is fire-and-forget, so the job can land a moment after the response.
  async function waitForJobs(count: number): Promise<Job<ClickEventV1>[]> {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed']);
      if (jobs.length >= count || Date.now() > deadline) return jobs;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('enqueues one valid v1 event per successful redirect', async () => {
    const link = await createLink(prisma, user.id, { code: 'click01' });

    await request(app.getHttpServer())
      .get('/click01')
      .set('Referer', 'https://News.Example.com/item?id=42&token=secret')
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
      .expect(302);

    const [job, ...rest] = await waitForJobs(1);
    expect(rest).toHaveLength(0);
    expect(job?.name).toBe(CLICK_JOB);
    expect(job?.id).toBe(job?.data.eventId);
    expect(clickEventV1.parse(job?.data)).toMatchObject({
      v: 1,
      shortLinkId: link.id,
      referrerHost: 'news.example.com',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    expect(job?.opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  });

  it('never ships the referrer path/query, and drops unusable referrers', async () => {
    await createLink(prisma, user.id, { code: 'click02' });

    await request(app.getHttpServer()).get('/click02').set('Referer', 'not a url').expect(302);
    await request(app.getHttpServer()).get('/click02').expect(302);

    const jobs = await waitForJobs(2);
    expect(jobs.map((job) => job.data.referrerHost)).toEqual([null, null]);
    expect(JSON.stringify(jobs.map((job) => job.data))).not.toContain('secret');
  });

  it('truncates oversized user agents to the contract limit', async () => {
    await createLink(prisma, user.id, { code: 'click03' });
    await request(app.getHttpServer())
      .get('/click03')
      .set('User-Agent', 'x'.repeat(2_000))
      .expect(302);

    const [job] = await waitForJobs(1);
    expect(job?.data.userAgent).toHaveLength(512);
    expect(clickEventV1.safeParse(job?.data).success).toBe(true);
  });

  it('records nothing for unknown, disabled or expired links', async () => {
    await createLink(prisma, user.id, { code: 'off0001', isActive: false });
    await createLink(prisma, user.id, { code: 'old0001', expiresAt: new Date(Date.now() - 1) });

    await request(app.getHttpServer()).get('/nope001').expect(404);
    await request(app.getHttpServer()).get('/off0001').expect(410);
    await request(app.getHttpServer()).get('/old0001').expect(410);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await queue.getJobCounts()).toMatchObject({ waiting: 0 });
  });

  it('gives each click its own event id, so separate clicks are never deduplicated', async () => {
    await createLink(prisma, user.id, { code: 'click04' });
    for (let i = 0; i < 3; i++) await request(app.getHttpServer()).get('/click04').expect(302);

    const ids = (await waitForJobs(3)).map((job) => job.data.eventId);
    expect(new Set(ids).size).toBe(3);
  });
});
