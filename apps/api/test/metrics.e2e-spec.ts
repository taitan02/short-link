import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, User } from '@short-link/prisma';
import request from 'supertest';
import { ApiMetrics } from '../src/metrics/metrics.module';
import { counterValue, createLink, createTestApp, createUser, resetState } from './utils';

describe('API metrics (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let metrics: ApiMetrics;
  let user: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    metrics = app.get(ApiMetrics);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    user = await createUser(prisma);
    metrics.registry.resetMetrics();
  });

  it('counts redirect cache misses and hits', async () => {
    await createLink(prisma, user.id, { code: 'metric1' });

    await request(app.getHttpServer()).get('/metric1').expect(302);
    await request(app.getHttpServer()).get('/metric1').expect(302);
    await request(app.getHttpServer()).get('/metric1').expect(302);

    await expect(
      counterValue(metrics, 'redirect_cache_lookups_total', { result: 'miss' }),
    ).resolves.toBe(1);
    await expect(
      counterValue(metrics, 'redirect_cache_lookups_total', { result: 'hit' }),
    ).resolves.toBe(2);
  });

  it('labels request durations by route template, not by the raw URL', async () => {
    await createLink(prisma, user.id, { code: 'metric2' });
    await request(app.getHttpServer()).get('/metric2').expect(302);
    await request(app.getHttpServer()).get('/nope123').expect(404);
    await request(app.getHttpServer()).get('/a/b/c').expect(404);
    await request(app.getHttpServer()).get('/api/links').expect(401);

    const text = await metrics.registry.getSingleMetricAsString('http_request_duration_seconds');
    expect(text).toContain('route="/:code",status="302"');
    expect(text).toContain('route="/:code",status="404"');
    // Unknown paths hit Nest's catch-all route: still one bounded label value.
    expect(text).toContain('route="{/*splat}",status="404"');
    expect(text).toContain('route="/api/links",status="401"');
    expect(text).not.toContain('metric2');
    expect(text).not.toContain('nope123');
  });
});
