import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService, ShortLink, User } from '@short-link/prisma';
import request from 'supertest';
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

let ipSeq = 0;

/** A fresh client address, so IP-keyed rate limits from earlier requests don't interfere. */
export function uniqueIp(): string {
  ipSeq++;
  return `198.18.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
}

export async function registerAndLogin(app: NestExpressApplication, email?: string) {
  const credentials = {
    email: email ?? `user${++userSeq}@example.com`,
    password: 'correct horse battery staple',
  };
  const server = app.getHttpServer();
  const ip = uniqueIp();
  const registered = await request(server)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send(credentials)
    .expect(201);
  const login = await request(server)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send(credentials)
    .expect(200);
  return {
    user: registered.body as { id: string; email: string },
    token: (login.body as { accessToken: string }).accessToken,
    credentials,
  };
}
