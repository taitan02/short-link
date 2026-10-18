import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@short-link/prisma';
import { CachedLink, LinkCacheService, toCachedLink } from '../links/link-cache.service';
import { isReservedCode, isValidShortCode } from '../links/short-code';

@Injectable()
export class RedirectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: LinkCacheService,
  ) {}

  /** Returns the destination URL, or throws 404 (unknown/deleted) or 410 (disabled/expired). */
  async resolve(code: string): Promise<string> {
    // Malformed codes can never exist, so reject them without touching cache or database.
    if (!isValidShortCode(code) || isReservedCode(code)) {
      throw new NotFoundException('Link not found');
    }

    const cached = await this.cache.get(code);
    const link = cached.hit ? cached.link : await this.loadAndCache(code);

    if (!link) throw new NotFoundException('Link not found');
    if (!link.isActive || (link.expiresAt !== null && link.expiresAt <= Date.now())) {
      throw new GoneException('Link is no longer available');
    }
    return link.originalUrl;
  }

  private async loadAndCache(code: string): Promise<CachedLink | null> {
    const row = await this.prisma.shortLink.findUnique({
      where: { code },
      select: {
        originalUrl: true,
        isActive: true,
        expiresAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });
    const link = toCachedLink(row);
    await this.cache.set(code, row?.updatedAt.getTime() ?? 0, link);
    return link;
  }
}
