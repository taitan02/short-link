import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaService, ShortLink } from '@short-link/prisma';
import { Env } from '../config/env';
import { parseDestinationUrl } from './destination-url';
import {
  CreateLinkDto,
  LinkPageDto,
  LinkResponseDto,
  ListLinksQueryDto,
  UpdateLinkDto,
} from './links.dto';
import { ShortCodeGenerator, isReservedCode } from './short-code';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name);
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: ShortCodeGenerator,
    config: ConfigService<Env, true>,
  ) {
    this.publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
  }

  async create(userId: string, dto: CreateLinkDto): Promise<LinkResponseDto> {
    const data = {
      userId,
      originalUrl: this.destinationOrThrow(dto.url),
      expiresAt: dto.expiresAt ?? null,
    };
    if (dto.expiresAt) this.assertFuture(dto.expiresAt);

    if (dto.alias !== undefined) {
      if (isReservedCode(dto.alias)) throw new BadRequestException('alias is reserved');
      try {
        return this.toResponse(
          await this.prisma.shortLink.create({ data: { ...data, code: dto.alias } }),
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException('alias is already taken');
        throw error;
      }
    }

    // The unique index decides; checking for existence first would still race with other inserts.
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = this.codes.generate();
      if (isReservedCode(code)) continue;
      try {
        return this.toResponse(await this.prisma.shortLink.create({ data: { ...data, code } }));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn({ attempt }, 'Short code collision, retrying');
      }
    }
    // Several collisions in a row means the keyspace is filling up or the RNG is broken;
    // either way it needs a human, not more retries.
    this.logger.error({ attempts: MAX_CODE_ATTEMPTS }, 'Could not allocate a unique short code');
    throw new InternalServerErrorException('Could not allocate a short code, please retry');
  }

  async list(userId: string, query: ListLinksQueryDto): Promise<LinkPageDto> {
    const where: Prisma.ShortLinkWhereInput = { userId, deletedAt: null };
    const now = new Date();

    switch (query.status) {
      case 'active':
        where.isActive = true;
        where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
        break;
      case 'inactive':
        where.isActive = false;
        break;
      case 'expired':
        where.expiresAt = { lte: now };
        break;
    }
    if (query.q) {
      // Scoped by userId first, so this only scans one user's links.
      where.AND = {
        OR: [
          { code: { contains: query.q, mode: 'insensitive' } },
          { originalUrl: { contains: query.q, mode: 'insensitive' } },
        ],
      };
    }

    const primaryOrder: Prisma.ShortLinkOrderByWithRelationInput =
      query.sortBy === 'expiresAt'
        ? { expiresAt: { sort: query.sortOrder, nulls: 'last' } }
        : { createdAt: query.sortOrder };

    const [items, total] = await Promise.all([
      this.prisma.shortLink.findMany({
        where,
        // id breaks ties so pages don't shuffle rows that share a timestamp or a null expiresAt.
        orderBy: [primaryOrder, { id: query.sortOrder }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.shortLink.count({ where }),
    ]);

    return {
      items: items.map((link) => this.toResponse(link)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(userId: string, id: string): Promise<LinkResponseDto> {
    return this.toResponse(await this.findOwnedOrThrow(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateLinkDto): Promise<LinkResponseDto> {
    await this.findOwnedOrThrow(userId, id);
    if (dto.expiresAt) this.assertFuture(dto.expiresAt);

    const link = await this.prisma.shortLink.update({
      where: { id },
      data: {
        originalUrl: dto.url === undefined ? undefined : this.destinationOrThrow(dto.url),
        isActive: dto.isActive,
        expiresAt: dto.expiresAt,
      },
    });
    return this.toResponse(link);
  }

  // Soft delete: the code stays taken forever, so nobody can re-register it and capture
  // traffic from links that are still shared around.
  async remove(userId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(userId, id);
    await this.prisma.shortLink.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Someone else's link and a missing link are indistinguishable, so ids can't be probed.
  private async findOwnedOrThrow(userId: string, id: string): Promise<ShortLink> {
    const link = await this.prisma.shortLink.findFirst({ where: { id, userId, deletedAt: null } });
    if (!link) throw new NotFoundException('Link not found');
    return link;
  }

  private destinationOrThrow(raw: string): string {
    const result = parseDestinationUrl(raw, this.publicBaseUrl);
    if (!result.ok) throw new BadRequestException(result.reason);
    return result.url;
  }

  private assertFuture(date: Date): void {
    if (date.getTime() <= Date.now())
      throw new BadRequestException('expiresAt must be in the future');
  }

  private toResponse(link: ShortLink): LinkResponseDto {
    return {
      id: link.id,
      code: link.code,
      shortUrl: `${this.publicBaseUrl}/${link.code}`,
      originalUrl: link.originalUrl,
      isActive: link.isActive,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
