import { Injectable } from '@nestjs/common';
import { ClickEventV1 } from '@short-link/contracts';
import { Prisma, PrismaService } from '@short-link/prisma';
import { parseUserAgent } from './user-agent';

export type IngestResult = 'recorded' | 'duplicate';

/** The event refers to a link that no longer exists; retrying cannot help. */
export class UnknownLinkError extends Error {}

const DIRECT = '(direct)';

@Injectable()
export class ClickIngestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records the raw event and bumps the daily counters in one transaction. The raw insert is
   * the idempotency check: if this eventId was already recorded (BullMQ redelivers after a
   * crash or a stalled lock), nothing is counted again. Effectively-once counting is a property
   * of this transaction, not of the queue, which only guarantees at-least-once.
   */
  async ingest(event: ClickEventV1): Promise<IngestResult> {
    const client = parseUserAgent(event.userAgent);
    const clickedAt = new Date(event.clickedAt);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.clickEvent.createMany({
          data: {
            id: event.eventId,
            shortLinkId: event.shortLinkId,
            clickedAt,
            referrerHost: event.referrerHost,
            ...client,
          },
          skipDuplicates: true,
        });
        if (count === 0) return 'duplicate';

        // Rows are always touched in the same order, so concurrent jobs for one link queue on
        // row locks instead of deadlocking.
        await tx.$executeRaw`
          INSERT INTO link_daily_stats (short_link_id, day, dimension, value, clicks)
          SELECT ${event.shortLinkId}::uuid, (${clickedAt}::timestamptz AT TIME ZONE 'UTC')::date, d.dimension, d.value, 1
          FROM (VALUES
            ('browser', ${client.browser}),
            ('device', ${client.deviceType}),
            ('referrer', ${event.referrerHost ?? DIRECT}),
            ('total', '')
          ) AS d(dimension, value)
          ON CONFLICT (short_link_id, dimension, day, value)
          DO UPDATE SET clicks = link_daily_stats.clicks + 1`;
        return 'recorded';
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new UnknownLinkError(`Short link ${event.shortLinkId} does not exist`);
      }
      throw error;
    }
  }
}
