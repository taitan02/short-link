import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, User } from '@short-link/prisma';
import request from 'supertest';
import { createLink, createTestApp, createUser, resetDatabase } from './utils';

describe('Redirect (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let user: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await createUser(prisma);
  });

  const get = (path: string) => request(app.getHttpServer()).get(path).redirects(0);

  it('redirects an active link with 302 and no caching', async () => {
    await createLink(prisma, user.id, { code: 'aB91xK', originalUrl: 'https://example.com/p?x=1' });

    await get('/aB91xK')
      .expect(302)
      .expect('Location', 'https://example.com/p?x=1')
      .expect('Cache-Control', 'no-store');
  });

  it('redirects a link whose expiration is still in the future', async () => {
    await createLink(prisma, user.id, {
      code: 'later01',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await get('/later01').expect(302);
  });

  it('is case-sensitive', async () => {
    await createLink(prisma, user.id, { code: 'aB91xK' });
    await get('/ab91xk').expect(404);
  });

  it('returns 404 for an unknown code', async () => {
    await get('/nope123').expect(404);
  });

  it('returns 404 for a deleted link', async () => {
    await createLink(prisma, user.id, { code: 'gone001', deletedAt: new Date() });
    await get('/gone001').expect(404);
  });

  it('returns 410 for a disabled link', async () => {
    await createLink(prisma, user.id, { code: 'off0001', isActive: false });
    await get('/off0001').expect(410);
  });

  it('returns 410 for an expired link', async () => {
    await createLink(prisma, user.id, { code: 'old0001', expiresAt: new Date(Date.now() - 1) });
    await get('/old0001').expect(410);
  });

  it.each(['/ab', '/has.dot', `/${'a'.repeat(33)}`])(
    'returns 404 for malformed code %s',
    async (path) => {
      await get(path).expect(404);
    },
  );

  it('does not shadow the API docs', async () => {
    await get('/docs').expect(200);
    await get('/docs-json').expect(200).expect('Content-Type', /json/);
  });
});
