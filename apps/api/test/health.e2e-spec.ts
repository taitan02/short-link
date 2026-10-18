import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '@short-link/prisma';
import request from 'supertest';
import { createTestApp } from './utils';

describe('Health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns ok', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
  });

  it('GET /health/ready reports the database as up', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok', checks: { database: 'up' } });
  });

  it('generates a request id when none is sent', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed incoming request id', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'upstream-abc_123')
      .expect('x-request-id', 'upstream-abc_123');
  });

  it('replaces a malformed incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'bad id\twith spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects oversized JSON bodies before routing', async () => {
    await request(app.getHttpServer())
      .post('/health/live')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(20_000) }))
      .expect(413);
  });
});

describe('Health (e2e, database down)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(PrismaService).useValue({
        $queryRaw: () => Promise.reject(new Error('connection refused')),
        $disconnect: () => Promise.resolve(),
      }),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready returns 503 while liveness stays green', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect({ status: 'error', checks: { database: 'down' } });
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
});
