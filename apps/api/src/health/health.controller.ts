import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@short-link/prisma';

const CHECK_TIMEOUT_MS = 1_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  // Liveness never touches dependencies: a DB outage must not make the orchestrator restart
  // API processes that are themselves healthy.
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness takes the instance out of the load balancer while the DB is unreachable.
  @Get('ready')
  async ready() {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.warn({ err: error }, 'Readiness check failed: database');
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
