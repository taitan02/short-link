import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // No HTTP server: the process lives as long as its BullMQ connections do.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // On SIGTERM, Nest closes the BullMQ workers, which stop taking new jobs and wait for the
  // ones in flight to finish before the process exits. The orchestrator's stop timeout must
  // exceed the longest job; anything cut off is redelivered as stalled and deduplicated.
  app.enableShutdownHooks();
  app.get(Logger).log('Analytics worker started');
}

void bootstrap();
