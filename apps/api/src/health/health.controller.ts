import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '@short-link/prisma';
import Redis from 'ioredis';
import { Public } from '../auth/auth.decorators';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 1_000;

async function withTimeout(check: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Probes must not need credentials, and must never be rate limited into failing.
@Public()
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Liveness never touches dependencies: a DB outage must not make the orchestrator restart
  // API processes that are themselves healthy.
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness takes the instance out of the load balancer only for what it can't work
  // without. Redis is not on that list: redirects fall back to PostgreSQL and rate limiting
  // fails open, so failing readiness on Redis would turn a cache outage into a full outage.
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`),
      withTimeout(this.redis.ping()),
    ]);
    const checks = { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' };

    if (!database) {
      this.logger.warn({ checks }, 'Readiness check failed');
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: redis ? 'ok' : 'degraded', checks };
  }
}
