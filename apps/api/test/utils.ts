import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, ShortLink, User } from '@short-link/prisma';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
) {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRaw`TRUNCATE TABLE short_links, users`;
}

let userSeq = 0;

export function createUser(prisma: PrismaService): Promise<User> {
  return prisma.user.create({
    data: { email: `user${++userSeq}@example.com`, passwordHash: 'not-a-real-hash' },
  });
}

let codeSeq = 0;

export function createLink(
  prisma: PrismaService,
  userId: string,
  data: Partial<Omit<ShortLink, 'id' | 'userId'>> = {},
): Promise<ShortLink> {
  return prisma.shortLink.create({
    data: {
      userId,
      code: `seed${++codeSeq}`,
      originalUrl: 'https://example.com/',
      ...data,
    },
  });
}
