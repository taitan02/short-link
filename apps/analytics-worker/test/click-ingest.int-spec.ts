import { TestingModule } from '@nestjs/testing';
import { PrismaService, ShortLink } from '@short-link/prisma';
import { ClickIngestService, UnknownLinkError } from '../src/clicks/click-ingest.service';
import { clickEvent, createLink, createWorker, resetDatabase, stats } from './utils';

describe('ClickIngestService (integration)', () => {
  let worker: TestingModule;
  let prisma: PrismaService;
  let ingest: ClickIngestService;
  let link: ShortLink;

  beforeAll(async () => {
    ({ worker, prisma } = await createWorker());
    ingest = worker.get(ClickIngestService);
  });

  afterAll(async () => {
    await worker.close();
  });

  beforeEach(async () => {
    await resetDatabase(worker);
    link = await createLink(prisma);
  });

  it('stores the raw event without the user agent and bumps every dimension once', async () => {
    const event = clickEvent(link.id);

    await expect(ingest.ingest(event)).resolves.toBe('recorded');

    await expect(
      prisma.clickEvent.findUnique({ where: { id: event.eventId } }),
    ).resolves.toMatchObject({
      shortLinkId: link.id,
      referrerHost: 'news.example.com',
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
    });
    await expect(stats(prisma, link.id)).resolves.toEqual([
      { dimension: 'browser', value: 'Chrome', clicks: 1 },
      { dimension: 'device', value: 'desktop', clicks: 1 },
      { dimension: 'referrer', value: 'news.example.com', clicks: 1 },
      { dimension: 'total', value: '', clicks: 1 },
    ]);
  });

  it('counts a redelivered event only once', async () => {
    const event = clickEvent(link.id);

    await expect(ingest.ingest(event)).resolves.toBe('recorded');
    await expect(ingest.ingest(event)).resolves.toBe('duplicate');
    await expect(ingest.ingest({ ...event })).resolves.toBe('duplicate');

    await expect(prisma.clickEvent.count()).resolves.toBe(1);
    const total = (await stats(prisma, link.id)).find((row) => row.dimension === 'total');
    expect(total?.clicks).toBe(1);
  });

  it('stays exact under concurrent deliveries of different and duplicate events', async () => {
    const events = Array.from({ length: 20 }, () => clickEvent(link.id));
    await Promise.all([...events, ...events].map((event) => ingest.ingest(event)));

    const total = (await stats(prisma, link.id)).find((row) => row.dimension === 'total');
    expect(total?.clicks).toBe(20);
  });

  it('files clicks without a referrer under (direct)', async () => {
    await ingest.ingest(clickEvent(link.id, { referrerHost: null, userAgent: null }));

    await expect(stats(prisma, link.id)).resolves.toEqual(
      expect.arrayContaining([
        { dimension: 'referrer', value: '(direct)', clicks: 1 },
        { dimension: 'device', value: 'unknown', clicks: 1 },
        { dimension: 'browser', value: 'Other', clicks: 1 },
      ]),
    );
  });

  it('buckets by UTC day, whatever offset the timestamp carries', async () => {
    await ingest.ingest(clickEvent(link.id, { clickedAt: '2026-10-18T23:30:00-05:00' }));

    const row = await prisma.linkDailyStat.findFirstOrThrow({
      where: { shortLinkId: link.id, dimension: 'total' },
    });
    expect(row.day.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('rejects events for links that do not exist, writing nothing', async () => {
    const event = clickEvent('00000000-0000-7000-8000-000000000000');

    await expect(ingest.ingest(event)).rejects.toBeInstanceOf(UnknownLinkError);
    await expect(prisma.clickEvent.count()).resolves.toBe(0);
    await expect(prisma.linkDailyStat.count()).resolves.toBe(0);
  });
});
