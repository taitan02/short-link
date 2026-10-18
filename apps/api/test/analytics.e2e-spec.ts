import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '@short-link/prisma';
import request from 'supertest';
import { LinkAnalyticsDto } from '../src/analytics/analytics.dto';
import { createTestApp, registerAndLogin, resetState } from './utils';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('Link analytics API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let linkId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    token = (await registerAndLogin(app)).token;
    const created = await request(app.getHttpServer())
      .post('/api/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/' })
      .expect(201);
    linkId = (created.body as { id: string }).id;
  });

  const get = (query: Record<string, string> = {}, as = token, id = linkId) =>
    request(app.getHttpServer())
      .get(`/api/links/${id}/analytics`)
      .query(query)
      .set('Authorization', `Bearer ${as}`);

  const seed = (rows: [string, string, string, number][]) =>
    prisma.linkDailyStat.createMany({
      data: rows.map(([date, dimension, value, clicks]) => ({
        shortLinkId: linkId,
        day: day(date),
        dimension,
        value,
        clicks,
      })),
    });

  it('returns zero-filled daily totals and ranked breakdowns for the range', async () => {
    await seed([
      ['2026-10-01', 'total', '', 5],
      ['2026-10-03', 'total', '', 2],
      ['2026-10-01', 'referrer', '(direct)', 1],
      ['2026-10-01', 'referrer', 'news.example.com', 4],
      ['2026-10-03', 'referrer', 'news.example.com', 2],
      ['2026-10-01', 'device', 'mobile', 3],
      ['2026-10-01', 'device', 'desktop', 2],
      ['2026-10-03', 'device', 'bot', 2],
      ['2026-10-01', 'browser', 'Safari', 5],
      ['2026-10-03', 'browser', 'Chrome', 2],
      // Outside the requested range.
      ['2026-09-30', 'total', '', 100],
      ['2026-09-30', 'referrer', 'old.example', 100],
    ]);

    const res = await get({ from: '2026-10-01', to: '2026-10-03' }).expect(200);

    expect(res.body).toEqual({
      from: '2026-10-01',
      to: '2026-10-03',
      totalClicks: 7,
      daily: [
        { date: '2026-10-01', clicks: 5 },
        { date: '2026-10-02', clicks: 0 },
        { date: '2026-10-03', clicks: 2 },
      ],
      referrers: [
        { value: 'news.example.com', clicks: 6 },
        { value: '(direct)', clicks: 1 },
      ],
      devices: [
        { value: 'mobile', clicks: 3 },
        { value: 'bot', clicks: 2 },
        { value: 'desktop', clicks: 2 },
      ],
      browsers: [
        { value: 'Safari', clicks: 5 },
        { value: 'Chrome', clicks: 2 },
      ],
    } satisfies LinkAnalyticsDto);
  });

  it('defaults to the last 30 days ending today (UTC)', async () => {
    const res = await get().expect(200);
    const body = res.body as LinkAnalyticsDto;

    expect(body.daily).toHaveLength(30);
    expect(body.to).toBe(new Date().toISOString().slice(0, 10));
    expect(body.totalClicks).toBe(0);
  });

  it('caps breakdowns at the top 10', async () => {
    await seed(
      Array.from({ length: 15 }, (_, i) => ['2026-10-01', 'referrer', `site${i}.example`, i + 1]),
    );
    const body = (await get({ from: '2026-10-01', to: '2026-10-01' }).expect(200))
      .body as LinkAnalyticsDto;

    expect(body.referrers).toHaveLength(10);
    expect(body.referrers[0]).toEqual({ value: 'site14.example', clicks: 15 });
  });

  it.each([
    [{ from: '2026-10-05', to: '2026-10-01' }, 'after'],
    [{ from: '2024-01-01', to: '2026-01-01' }, 'exceed'],
    [{ from: '2026-02-30' }, 'not a valid date'],
    [{ from: '10/01/2026' }, 'YYYY-MM-DD'],
  ])('rejects %j', async (query, message) => {
    const res = await get(query).expect(400);
    expect(JSON.stringify(res.body)).toContain(message);
  });

  it('hides other users’ links and requires authentication', async () => {
    const other = (await registerAndLogin(app)).token;
    await get({}, other).expect(404);
    await request(app.getHttpServer()).get(`/api/links/${linkId}/analytics`).expect(401);
  });

  it('treats deleted links as gone', async () => {
    await request(app.getHttpServer())
      .delete(`/api/links/${linkId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await get().expect(404);
  });
});
