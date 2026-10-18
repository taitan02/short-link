import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma, PrismaService, User } from '@short-link/prisma';
import { LinksService } from '../src/links/links.service';
import { ShortCodeGenerator } from '../src/links/short-code';
import { createLink, createTestApp, createUser, resetState } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

describe('LinksService (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let links: LinksService;
  const generate = jest.fn<string, []>();
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((builder) =>
      builder.overrideProvider(ShortCodeGenerator).useValue({ generate }),
    ));
    links = app.get(LinksService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetState(app);
    alice = await createUser(prisma);
    bob = await createUser(prisma);
    const real = new ShortCodeGenerator();
    generate.mockReset().mockImplementation(() => real.generate());
  });

  describe('create', () => {
    it('stores a normalized URL under a generated code', async () => {
      const link = await links.create(alice.id, { url: 'HTTPS://Example.com/a?b=1' });

      expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/);
      expect(link.shortUrl).toBe(`https://sho.rt/${link.code}`);
      expect(link).toMatchObject({ originalUrl: 'https://example.com/a?b=1', isActive: true });
      await expect(
        prisma.shortLink.findUnique({ where: { code: link.code } }),
      ).resolves.toMatchObject({
        userId: alice.id,
      });
    });

    it('retries on a code collision and uses the next code', async () => {
      await createLink(prisma, bob.id, { code: 'taken01' });
      generate.mockReturnValueOnce('taken01').mockReturnValueOnce('fresh01');

      await expect(links.create(alice.id, { url: 'https://example.com' })).resolves.toMatchObject({
        code: 'fresh01',
      });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('skips generated codes that are reserved words', async () => {
      generate.mockReturnValueOnce('metrics').mockReturnValueOnce('fresh02');
      await expect(links.create(alice.id, { url: 'https://example.com' })).resolves.toMatchObject({
        code: 'fresh02',
      });
    });

    it('gives up after a bounded number of collisions', async () => {
      await createLink(prisma, bob.id, { code: 'taken01' });
      generate.mockReturnValue('taken01');

      await expect(links.create(alice.id, { url: 'https://example.com' })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(generate).toHaveBeenCalledTimes(5);
    });

    it('accepts a free custom alias', async () => {
      await expect(
        links.create(alice.id, { url: 'https://example.com', alias: 'summer-sale' }),
      ).resolves.toMatchObject({ code: 'summer-sale' });
      expect(generate).not.toHaveBeenCalled();
    });

    it('rejects a taken alias with 409, even if the owner deleted it', async () => {
      await createLink(prisma, bob.id, { code: 'promo', deletedAt: new Date() });
      await expect(
        links.create(alice.id, { url: 'https://example.com', alias: 'promo' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats aliases as case-sensitive', async () => {
      await createLink(prisma, bob.id, { code: 'Promo' });
      await expect(
        links.create(alice.id, { url: 'https://example.com', alias: 'promo' }),
      ).resolves.toMatchObject({ code: 'promo' });
    });

    it.each(['api', 'Docs', 'HEALTH'])('rejects reserved alias %s', async (alias) => {
      await expect(links.create(alice.id, { url: 'https://example.com', alias })).rejects.toThrow(
        'alias is reserved',
      );
    });

    it('rejects invalid destinations', async () => {
      await expect(links.create(alice.id, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(links.create(alice.id, { url: 'https://sho.rt/abc' })).rejects.toThrow(
        'this service',
      );
    });

    it('rejects an expiration in the past', async () => {
      await expect(
        links.create(alice.id, { url: 'https://example.com', expiresAt: inDays(-1) }),
      ).rejects.toThrow('expiresAt must be in the future');
    });
  });

  describe('list', () => {
    const query = (overrides: Partial<Parameters<LinksService['list']>[1]> = {}) => ({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const,
      ...overrides,
    });

    it('returns only the caller’s non-deleted links', async () => {
      const own = await createLink(prisma, alice.id);
      await createLink(prisma, alice.id, { deletedAt: new Date() });
      await createLink(prisma, bob.id);

      const page = await links.list(alice.id, query());
      expect(page.total).toBe(1);
      expect(page.items.map((l) => l.id)).toEqual([own.id]);
    });

    it('paginates newest first with a stable order', async () => {
      const base = Date.now();
      const created = [];
      for (let i = 0; i < 5; i++) {
        created.push(await createLink(prisma, alice.id, { createdAt: new Date(base + i * 1000) }));
      }
      const newestFirst = created.reverse().map((l) => l.id);

      const first = await links.list(alice.id, query({ page: 1, pageSize: 2 }));
      const third = await links.list(alice.id, query({ page: 3, pageSize: 2 }));

      expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(first.items.map((l) => l.id)).toEqual(newestFirst.slice(0, 2));
      expect(third.items.map((l) => l.id)).toEqual(newestFirst.slice(4));
    });

    it('filters by status', async () => {
      const active = await createLink(prisma, alice.id, { expiresAt: inDays(1) });
      const disabled = await createLink(prisma, alice.id, { isActive: false });
      const expired = await createLink(prisma, alice.id, { expiresAt: inDays(-1) });

      const ids = async (status: 'active' | 'inactive' | 'expired') =>
        (await links.list(alice.id, query({ status }))).items.map((l) => l.id);

      expect(await ids('active')).toEqual([active.id]);
      expect(await ids('inactive')).toEqual([disabled.id]);
      expect(await ids('expired')).toEqual([expired.id]);
    });

    it('searches code and destination case-insensitively', async () => {
      const byUrl = await createLink(prisma, alice.id, {
        originalUrl: 'https://shop.example/SUMMER',
      });
      const byCode = await createLink(prisma, alice.id, { code: 'Summer26' });
      await createLink(prisma, alice.id, { originalUrl: 'https://other.example/' });

      const page = await links.list(alice.id, query({ q: 'summer' }));
      expect(page.items.map((l) => l.id).sort()).toEqual([byUrl.id, byCode.id].sort());
    });

    it('sorts by expiresAt with links that never expire last', async () => {
      const never = await createLink(prisma, alice.id);
      const later = await createLink(prisma, alice.id, { expiresAt: inDays(10) });
      const sooner = await createLink(prisma, alice.id, { expiresAt: inDays(1) });

      const page = await links.list(alice.id, query({ sortBy: 'expiresAt', sortOrder: 'asc' }));
      expect(page.items.map((l) => l.id)).toEqual([sooner.id, later.id, never.id]);
    });
  });

  describe('ownership', () => {
    it('hides other users’ links behind 404 for get, update and remove', async () => {
      const bobs = await createLink(prisma, bob.id);

      await expect(links.get(alice.id, bobs.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(links.update(alice.id, bobs.id, { isActive: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(links.remove(alice.id, bobs.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(prisma.shortLink.findUnique({ where: { id: bobs.id } })).resolves.toMatchObject({
        isActive: true,
        deletedAt: null,
      });
    });
  });

  describe('update', () => {
    it('changes destination, status and expiration', async () => {
      const link = await createLink(prisma, alice.id, { expiresAt: inDays(1) });

      const updated = await links.update(alice.id, link.id, {
        url: 'https://NEW.example/x',
        isActive: false,
        expiresAt: null,
      });
      expect(updated).toMatchObject({
        originalUrl: 'https://new.example/x',
        isActive: false,
        expiresAt: null,
        code: link.code,
      });
    });

    it('leaves omitted fields untouched', async () => {
      const expiresAt = inDays(1);
      const link = await createLink(prisma, alice.id, { expiresAt });

      const updated = await links.update(alice.id, link.id, { isActive: false });
      expect(updated.expiresAt).toEqual(expiresAt);
      expect(updated.originalUrl).toBe(link.originalUrl);
    });
  });

  describe('remove', () => {
    it('soft-deletes so the code stays reserved', async () => {
      const link = await createLink(prisma, alice.id);

      await links.remove(alice.id, link.id);

      await expect(links.get(alice.id, link.id)).rejects.toBeInstanceOf(NotFoundException);
      const row = await prisma.shortLink.findUnique({ where: { id: link.id } });
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('database constraints', () => {
    it('enforces unique codes even when the application check is bypassed', async () => {
      await createLink(prisma, alice.id, { code: 'dup0001' });
      const duplicate = createLink(prisma, bob.id, { code: 'dup0001' });

      await expect(duplicate).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects links for users that do not exist', async () => {
      await expect(
        createLink(prisma, '00000000-0000-7000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
