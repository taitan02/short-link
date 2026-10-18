import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShortLink } from '@short-link/prisma';
import Redis from 'ioredis';
import { Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/**
 * What the redirect needs to know about a code. `null` means "nothing to redirect to"
 * (no such code, or soft-deleted). Disabled and expiring links are cached as-is and the
 * redirect re-evaluates isActive/expiresAt on every read, so a cached entry can never serve a
 * link past its expiry, whatever its TTL.
 */
export interface CachedLink {
  originalUrl: string;
  isActive: boolean;
  expiresAt: number | null;
}

export type CacheLookup = { hit: true; link: CachedLink | null } | { hit: false };

// Codes nobody has created: cached briefly so scanners hitting random codes don't each cost a
// DB query, but short enough that a missed invalidation can't hide a new link for long.
const MISSING_TTL_SECONDS = 60;

// Entries are "<version>|<json>", version = the row's updatedAt in ms (0 for "no row").
// Writes only land if they are at least as new as what is cached. This closes the classic
// race where a redirect reads the old row from the DB, an edit commits and updates the cache,
// and then the redirect writes its stale copy back on top for a full TTL.
const SET_IF_NOT_OLDER = `
local current = redis.call('GET', KEYS[1])
if current then
  local version = tonumber(string.match(current, '^(%d+)|'))
  if version and version > tonumber(ARGV[1]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1] .. '|' .. ARGV[2], 'EX', ARGV[3])
return 1
`;

export function toCachedLink(
  row: Pick<ShortLink, 'originalUrl' | 'isActive' | 'expiresAt' | 'deletedAt'> | null,
): CachedLink | null {
  if (!row || row.deletedAt) return null;
  return {
    originalUrl: row.originalUrl,
    isActive: row.isActive,
    expiresAt: row.expiresAt?.getTime() ?? null,
  };
}

/** Every failure degrades to a cache miss or a skipped write; callers never see Redis errors. */
@Injectable()
export class LinkCacheService {
  private readonly logger = new Logger(LinkCacheService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('LINK_CACHE_TTL_SECONDS', { infer: true });
  }

  async get(code: string): Promise<CacheLookup> {
    let raw: string | null;
    try {
      raw = await this.redis.get(cacheKey(code));
    } catch (error) {
      this.logger.warn({ err: error, code }, 'Link cache read failed, falling back to database');
      return { hit: false };
    }
    if (raw === null) return { hit: false };

    const parsed = parseEntry(raw);
    if (parsed === undefined) {
      // Never guess a destination from a value we can't fully parse.
      this.logger.error({ code }, 'Malformed link cache entry, ignoring');
      return { hit: false };
    }
    return { hit: true, link: parsed };
  }

  /** @param version updatedAt of the row in ms, or 0 when the code has no row. */
  async set(code: string, version: number, link: CachedLink | null): Promise<void> {
    const ttl = link === null && version === 0 ? MISSING_TTL_SECONDS : this.ttlSeconds;
    try {
      await this.redis.eval(
        SET_IF_NOT_OLDER,
        1,
        cacheKey(code),
        version,
        JSON.stringify(link),
        ttl,
      );
    } catch (error) {
      // After an edit this leaves the previous state cached until its TTL runs out.
      this.logger.error({ err: error, code }, 'Link cache write failed');
    }
  }

  setFromRow(row: ShortLink): Promise<void> {
    return this.set(row.code, row.updatedAt.getTime(), toCachedLink(row));
  }
}

function cacheKey(code: string): string {
  return `link:${code}`;
}

function parseEntry(raw: string): CachedLink | null | undefined {
  const separator = raw.indexOf('|');
  if (separator < 0) return undefined;
  try {
    const value: unknown = JSON.parse(raw.slice(separator + 1));
    if (value === null) return null;
    if (
      typeof value === 'object' &&
      'originalUrl' in value &&
      typeof value.originalUrl === 'string' &&
      'isActive' in value &&
      typeof value.isActive === 'boolean' &&
      'expiresAt' in value &&
      (value.expiresAt === null || typeof value.expiresAt === 'number')
    ) {
      return {
        originalUrl: value.originalUrl,
        isActive: value.isActive,
        expiresAt: value.expiresAt,
      };
    }
  } catch {
    // fall through
  }
  return undefined;
}
