import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@short-link/prisma';
import {
  AnalyticsQueryDto,
  BreakdownEntryDto,
  DailyClicksDto,
  LinkAnalyticsDto,
} from './analytics.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const TOP_N = 10;

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects well-formed but impossible dates like 2026-02-30, which Date would roll over.
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return date;
}

/**
 * Reads only link_daily_stats, so a dashboard request costs a few index range scans over at
 * most (days x distinct values) rows, regardless of how many raw clicks exist. Numbers lag the
 * redirects by however long the worker queue takes to drain, normally seconds.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async forLink(
    userId: string,
    linkId: string,
    query: AnalyticsQueryDto,
  ): Promise<LinkAnalyticsDto> {
    const owned = await this.prisma.shortLink.findFirst({
      where: { id: linkId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Link not found');

    const to = query.to
      ? parseIsoDate(query.to, 'to')
      : new Date(`${toIsoDate(new Date())}T00:00:00.000Z`);
    const from = query.from
      ? parseIsoDate(query.from, 'from')
      : new Date(to.getTime() - (DEFAULT_DAYS - 1) * DAY_MS);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days < 1) throw new BadRequestException('from must not be after to');
    if (days > MAX_DAYS) throw new BadRequestException(`range must not exceed ${MAX_DAYS} days`);

    const range = { shortLinkId: linkId, day: { gte: from, lte: to } };
    const [totals, referrers, devices, browsers] = await Promise.all([
      this.prisma.linkDailyStat.findMany({
        where: { ...range, dimension: 'total' },
        select: { day: true, clicks: true },
      }),
      this.breakdown(range, 'referrer'),
      this.breakdown(range, 'device'),
      this.breakdown(range, 'browser'),
    ]);

    const byDay = new Map(totals.map((row) => [toIsoDate(row.day), row.clicks]));
    const daily: DailyClicksDto[] = Array.from({ length: days }, (_, i) => {
      const date = toIsoDate(new Date(from.getTime() + i * DAY_MS));
      return { date, clicks: byDay.get(date) ?? 0 };
    });

    return {
      from: toIsoDate(from),
      to: toIsoDate(to),
      totalClicks: daily.reduce((sum, day) => sum + day.clicks, 0),
      daily,
      referrers,
      devices,
      browsers,
    };
  }

  private async breakdown(
    range: { shortLinkId: string; day: { gte: Date; lte: Date } },
    dimension: 'referrer' | 'device' | 'browser',
  ): Promise<BreakdownEntryDto[]> {
    const rows = await this.prisma.linkDailyStat.groupBy({
      by: ['value'],
      where: { ...range, dimension },
      _sum: { clicks: true },
      orderBy: [{ _sum: { clicks: 'desc' } }, { value: 'asc' }],
      take: TOP_N,
    });
    return rows.map((row) => ({ value: row.value, clicks: row._sum.clicks ?? 0 }));
  }
}
