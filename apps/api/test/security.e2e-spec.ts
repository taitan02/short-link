import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { RedirectService } from '../src/redirect/redirect.service';
import { createTestApp } from './utils';

describe('HTTP hardening (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins', async () => {
    await request(app.getHttpServer())
      .options('/api/links')
      .set('Origin', 'https://app.sho.rt')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'https://app.sho.rt');

    const foreign = await request(app.getHttpServer())
      .options('/api/links')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers oversized bodies with 413, not 500', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(20_000) }))
      .expect(413);
  });

  it('answers malformed JSON with 400 without leaking parser internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at \w+ \(/);
  });
});

describe('Unexpected errors (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(RedirectService).useValue({
        resolve: () => Promise.reject(new Error('connect to postgres://admin:hunter2@db failed')),
      }),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 500 with a generic body that leaks nothing', async () => {
    const res = await request(app.getHttpServer()).get('/abc1234').expect(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
