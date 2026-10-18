import './redis-unreachable';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, User } from '@short-link/prisma';
import request from 'supertest';
import { createLink, createTestApp, createUser } from './utils';

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

  it('stays ready, reporting a degraded cache', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
  });
});
