import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@short-link/prisma';
import { isReservedCode, isValidShortCode } from '../links/short-code';

@Injectable()
export class RedirectService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the destination URL, or throws 404 (unknown/deleted) or 410 (disabled/expired). */
  async resolve(code: string): Promise<string> {
    // Malformed codes can never exist, so reject them without touching the database.
    if (!isValidShortCode(code) || isReservedCode(code)) {
      throw new NotFoundException('Link not found');
    }

    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      select: { originalUrl: true, isActive: true, expiresAt: true, deletedAt: true },
    });
    if (!link || link.deletedAt) throw new NotFoundException('Link not found');
    if (!link.isActive || (link.expiresAt && link.expiresAt <= new Date())) {
      throw new GoneException('Link is no longer available');
    }
    return link.originalUrl;
  }
}
