import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { CLICK_QUEUE, ClickEventV1 } from '@short-link/contracts';
import { PrismaService, ShortLink } from '@short-link/prisma';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from '../src/worker.module';

export async function createWorker(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
) {
  const worker = await customize(Test.createTestingModule({ imports: [WorkerModule] })).compile();
  // Same logger as production, so LOG_LEVEL=silent applies to expected failures too.
  worker.useLogger(worker.get(Logger));
  await worker.init();
  return {
    worker,
    prisma: worker.get(PrismaService),
    clicks: worker.get<Queue>(getQueueToken(CLICK_QUEUE)),
  };
}

export async function resetDatabase(worker: TestingModule) {
  await worker.get(PrismaService)
    .$executeRaw`TRUNCATE TABLE link_daily_stats, click_events, short_links, users`;
}

let seq = 0;

export async function createLink(prisma: PrismaService): Promise<ShortLink> {
  seq++;
  const user = await prisma.user.create({
    data: { email: `worker${seq}@example.com`, passwordHash: 'not-a-real-hash' },
  });
  return prisma.shortLink.create({
    data: { userId: user.id, code: `wrk${seq}`, originalUrl: 'https://example.com/' },
  });
}

export function clickEvent(
  shortLinkId: string,
  overrides: Partial<ClickEventV1> = {},
): ClickEventV1 {
  return {
    v: 1,
    eventId: randomUUID(),
    shortLinkId,
    clickedAt: new Date().toISOString(),
    referrerHost: 'news.example.com',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    ...overrides,
  };
}

export async function waitForState(job: Job, states: string[], timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await job.getState();
    if (states.includes(state)) return state;
    if (Date.now() > deadline) throw new Error(`Job ${job.id} still ${state} after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function stats(prisma: PrismaService, shortLinkId: string) {
  return prisma.linkDailyStat.findMany({
    where: { shortLinkId },
    select: { dimension: true, value: true, clicks: true },
    orderBy: [{ dimension: 'asc' }, { value: 'asc' }],
  });
}
