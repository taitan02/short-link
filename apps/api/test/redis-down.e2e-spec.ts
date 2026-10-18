import './redis-unreachable';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, User } from '@short-link/prisma';
import request from 'supertest';
import { ApiMetrics } from '../src/metrics/metrics.module';
import { counterValue, createLink, createTestApp, createUser } from './utils';

describe('With Redis unavailable (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let user: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await prisma.$executeRaw`TRUNCATE TABLE link_daily_stats, click_events, short_links, users`;
    user = await createUser(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('redirects from the database, quickly', async () => {
    await createLink(prisma, user.id, { code: 'nocache', originalUrl: 'https://example.com/' });

    const started = Date.now();
    await request(app.getHttpServer())
      .get('/nocache')
      .redirects(0)
      .expect(302)
      .expect('Location', 'https://example.com/');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('still answers 404 and 410 correctly', async () => {
    await createLink(prisma, user.id, { code: 'disabled', isActive: false });
    await request(app.getHttpServer()).get('/disabled').expect(410);
    await request(app.getHttpServer()).get('/missing1').expect(404);
  });

  it('fails rate limiting open instead of rejecting traffic', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'guess' })
      .expect(401);
  });

  it('makes the degradation visible in metrics', async () => {
    const metrics = app.get(ApiMetrics);
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).get('/nocache').expect(302);

    await expect(
      counterValue(metrics, 'redirect_cache_lookups_total', { result: 'error' }),
    ).resolves.toBeGreaterThan(0);
    // Clicks wait on the dead queue up to the cap (2 here, counting earlier tests' clicks); the
    // rest are dropped instead of piling up in memory.
    await expect(counterValue(metrics, 'click_enqueue_pending')).resolves.toBe(2);
    await expect(
      counterValue(metrics, 'click_enqueue_failures_total', { reason: 'backlog_full' }),
    ).resolves.toBeGreaterThanOrEqual(3);
    await expect(counterValue(metrics, 'rate_limit_storage_errors_total')).resolves.toBeGreaterThan(
      0,
    );
  });

  it('stays ready, reporting a degraded cache', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
  });
});
