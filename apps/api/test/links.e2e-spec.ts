import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp, registerAndLogin, resetState } from './utils';

describe('Links API (e2e)', () => {
  let app: NestExpressApplication;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    alice = (await registerAndLogin(app)).token;
    bob = (await registerAndLogin(app)).token;
  });

  const api = (token: string) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
    return {
      create: (body: object) => auth(request(server).post('/api/links').send(body)),
      list: (query: object = {}) => auth(request(server).get('/api/links').query(query)),
      get: (id: string) => auth(request(server).get(`/api/links/${id}`)),
      update: (id: string, body: object) =>
        auth(request(server).patch(`/api/links/${id}`).send(body)),
      remove: (id: string) => auth(request(server).delete(`/api/links/${id}`)),
    };
  };

  const createLink = async (token: string, body: object = { url: 'https://example.com/' }) =>
    (await api(token).create(body).expect(201)).body as { id: string; code: string };

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/links').expect(401);
    await request(app.getHttpServer())
      .post('/api/links')
      .send({ url: 'https://example.com' })
      .expect(401);
  });

  it('creates a link that immediately redirects', async () => {
    const res = await api(alice)
      .create({ url: 'https://example.com/products?campaign=summer2026' })
      .expect(201);

    const link = res.body as { code: string; shortUrl: string };
    expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(link.shortUrl).toBe(`https://sho.rt/${link.code}`);
    expect(res.body).toMatchObject({
      originalUrl: 'https://example.com/products?campaign=summer2026',
      isActive: true,
      expiresAt: null,
    });
    expect(res.body).not.toHaveProperty('userId');

    await request(app.getHttpServer())
      .get(`/${link.code}`)
      .expect(302)
      .expect('Location', 'https://example.com/products?campaign=summer2026');
  });

  it('accepts a custom alias and an expiration', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    await api(alice)
      .create({ url: 'https://example.com', alias: 'summer-sale', expiresAt })
      .expect(201)
      .expect((res) => expect(res.body).toMatchObject({ code: 'summer-sale', expiresAt }));
    await api(bob).create({ url: 'https://example.com', alias: 'summer-sale' }).expect(409);
  });

  it.each([
    [{}],
    [{ url: 'https://example.com', alias: 'no spaces' }],
    [{ url: 'https://example.com', alias: 'api' }],
    [{ url: 'https://example.com', expiresAt: 'tomorrow' }],
    [{ url: 'https://example.com', userId: '00000000-0000-7000-8000-000000000000' }],
    [{ url: 'http://192.168.1.1/admin' }],
    [{ url: 'https://login.evil.example/' }],
  ])('rejects invalid input %j with 400', async (body) => {
    await api(alice).create(body).expect(400);
  });

  it('lists only the caller’s links with pagination metadata', async () => {
    for (let i = 0; i < 3; i++) await createLink(alice);
    await createLink(bob);

    const res = await api(alice).list({ page: 1, pageSize: 2 }).expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect((res.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it.each([{ pageSize: 101 }, { page: 0 }, { status: 'deleted' }, { sortBy: 'originalUrl' }])(
    'rejects invalid list query %j',
    async (query) => {
      await api(alice).list(query).expect(400);
    },
  );

  it('hides another user’s link behind 404 on every operation', async () => {
    const link = await createLink(alice);

    await api(bob).get(link.id).expect(404);
    await api(bob).update(link.id, { isActive: false }).expect(404);
    await api(bob).remove(link.id).expect(404);
    await api(alice).get(link.id).expect(200);
    await request(app.getHttpServer()).get(`/${link.code}`).expect(302);
  });

  it('rejects non-UUID ids with 400', async () => {
    await api(alice).get('not-a-uuid').expect(400);
  });

  it('disabling a link makes the redirect return 410', async () => {
    const link = await createLink(alice);
    await api(alice).update(link.id, { isActive: false }).expect(200);
    await request(app.getHttpServer()).get(`/${link.code}`).expect(410);
  });

  it('deleting a link makes the redirect return 404 and keeps the code taken', async () => {
    const link = await createLink(alice, { url: 'https://example.com', alias: 'mine' });
    await api(alice).remove(link.id).expect(204);

    await request(app.getHttpServer()).get('/mine').expect(404);
    await api(alice).get(link.id).expect(404);
    await api(bob).create({ url: 'https://example.com', alias: 'mine' }).expect(409);
  });

  it('limits link creation per account, not per IP', async () => {
    for (let i = 0; i < 30; i++) await createLink(alice);

    await api(alice).create({ url: 'https://example.com' }).expect(429);
    // Same IP (the test client), different account.
    await api(bob).create({ url: 'https://example.com' }).expect(201);
  });
});
