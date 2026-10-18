import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  // Liveness only: answers "is the process able to serve HTTP". Readiness (DB/Redis) comes with
  // those dependencies, and must stay separate so a DB outage doesn't make the orchestrator
  // restart healthy API processes in a loop.
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
