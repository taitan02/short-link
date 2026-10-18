import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, User } from '@short-link/prisma';
import Redis from 'ioredis';
import request from 'supertest';
import { LinkCacheService } from '../src/links/link-cache.service';
import {
  createLink,
  createTestApp,
  createUser,
  registerAndLogin,
  resetState,
  uniqueIp,
} from './utils';

const LINK_ID = '01a14e89-743f-722a-88c1-559ad54a843e';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Redirect cache (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let user: User;

  beforeAll(async () => {
    ({ app, prisma, redis } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    user = await createUser(prisma);
  });

  const visit = (code: string) => request(app.getHttpServer()).get(`/${code}`).redirects(0);

  it('populates the cache on a miss, versioned by updatedAt', async () => {
    const link = await createLink(prisma, user.id, { code: 'cache01' });
    expect(await redis.get('link:cache01')).toBeNull();

    await visit('cache01').expect(302);

    const entry = await redis.get('link:cache01');
    expect(entry).toBe(
      `${link.updatedAt.getTime()}|${JSON.stringify({
        id: link.id,
        originalUrl: link.originalUrl,
        isActive: true,
        expiresAt: null,
      })}`,
    );
    expect(await redis.ttl('link:cache01')).toBeGreaterThan(500);
  });

  it('serves hits from Redis without consulting the database', async () => {
    await createLink(prisma, user.id, { code: 'cache02', originalUrl: 'https://old.example/' });
    await visit('cache02').expect(302);

    // Bypasses LinksService, so nothing invalidates: only a cache hit can still return "old".
    await prisma.shortLink.update({
      where: { code: 'cache02' },
      data: { originalUrl: 'https://new.example/' },
    });

    await visit('cache02').expect(302).expect('Location', 'https://old.example/');
  });

  it('caches unknown codes briefly', async () => {
    await visit('nope001').expect(404);

    expect(await redis.get('link:nope001')).toBe('0|null');
    const ttl = await redis.ttl('link:nope001');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('re-evaluates expiry on every hit, so a cached link stops working on time', async () => {
    await createLink(prisma, user.id, {
      code: 'cache03',
      expiresAt: new Date(Date.now() + 1_000),
    });
    await visit('cache03').expect(302);

    await sleep(1_100);

    expect(await redis.exists('link:cache03')).toBe(1);
    await visit('cache03').expect(410);
  });

  it('ignores a malformed entry and answers from the database', async () => {
    await createLink(prisma, user.id, { code: 'cache04', originalUrl: 'https://right.example/' });
    await redis.set('link:cache04', 'garbage{');

    await visit('cache04').expect(302).expect('Location', 'https://right.example/');
  });

  describe('invalidation through the API', () => {
    let token: string;
    const api = () => ({
      create: (body: object) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(201),
      update: (id: string, body: object) =>
        request(app.getHttpServer())
          .patch(`/api/links/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(200),
      remove: (id: string) =>
        request(app.getHttpServer())
          .delete(`/api/links/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(204),
    });

    beforeEach(async () => {
      token = (await registerAndLogin(app)).token;
    });

    it('a new alias works immediately even after its code was cached as missing', async () => {
      await visit('fresh-alias').expect(404);
      await api().create({ url: 'https://example.com/new', alias: 'fresh-alias' });

      await visit('fresh-alias').expect(302).expect('Location', 'https://example.com/new');
    });

    it('editing the destination takes effect on the next redirect', async () => {
      const { id } = (await api().create({ url: 'https://a.example/', alias: 'edit-me' })).body as {
        id: string;
      };
      await visit('edit-me').expect(302).expect('Location', 'https://a.example/');

      await api().update(id, { url: 'https://b.example/' });

      await visit('edit-me').expect(302).expect('Location', 'https://b.example/');
    });

    it('disabling, re-enabling and deleting take effect immediately', async () => {
      const { id } = (await api().create({ url: 'https://a.example/', alias: 'toggle' })).body as {
        id: string;
      };
      await visit('toggle').expect(302);

      await api().update(id, { isActive: false });
      await visit('toggle').expect(410);

      await api().update(id, { isActive: true });
      await visit('toggle').expect(302);

      await api().remove(id);
      await visit('toggle').expect(404);
    });
  });

  describe('LinkCacheService versioning', () => {
    it('refuses to overwrite a newer entry with an older one', async () => {
      const cache = app.get(LinkCacheService);
      const fresh = {
        id: LINK_ID,
        originalUrl: 'https://new.example/',
        isActive: false,
        expiresAt: null,
      };
      const stale = {
        id: LINK_ID,
        originalUrl: 'https://old.example/',
        isActive: true,
        expiresAt: null,
      };

      // An edit at t=2000 lands first; a redirect that read the row as of t=1000 lands after.
      await cache.set('race01', 2_000, fresh);
      await cache.set('race01', 1_000, stale);

      await expect(cache.get('race01')).resolves.toEqual({ hit: true, link: fresh });
    });

    it('lets a newer write replace an older one', async () => {
      const cache = app.get(LinkCacheService);
      await cache.set('race02', 0, null);
      const created = {
        id: LINK_ID,
        originalUrl: 'https://x.example/',
        isActive: true,
        expiresAt: null,
      };
      await cache.set('race02', 1_000, created);

      await expect(cache.get('race02')).resolves.toEqual({ hit: true, link: created });
    });
  });
});

describe('Rate limits across instances (e2e)', () => {
  let first: NestExpressApplication;
  let second: NestExpressApplication;

  beforeAll(async () => {
    ({ app: first } = await createTestApp());
    ({ app: second } = await createTestApp());
    await resetState(first);
  });

  afterAll(async () => {
    await Promise.all([first.close(), second.close()]);
  });

  it('share one counter, so a client cannot multiply its quota by hitting other replicas', async () => {
    const ip = uniqueIp();
    const body = { email: 'nobody@example.com', password: 'guess' };
    const login = (app: NestExpressApplication) =>
      request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', ip).send(body);

    for (let i = 0; i < 10; i++) await login(i % 2 === 0 ? first : second).expect(401);

    await login(first).expect(429);
    await login(second).expect(429);
  });
});
