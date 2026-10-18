import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLICK_QUEUE, clickEventV1 } from '@short-link/contracts';
import { Job, UnrecoverableError } from 'bullmq';
import { Env } from '../config/env';
import { ClickIngestService, IngestResult, UnknownLinkError } from './click-ingest.service';

@Processor(CLICK_QUEUE)
export class ClickProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClickProcessor.name);

  constructor(
    private readonly ingest: ClickIngestService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  onApplicationBootstrap() {
    // @Processor options are static; concurrency comes from config.
    this.worker.concurrency = this.config.get('WORKER_CONCURRENCY', { infer: true });
  }

  async process(job: Job<unknown>): Promise<IngestResult> {
    const parsed = clickEventV1.safeParse(job.data);
    if (!parsed.success) {
      // A malformed payload fails the same way on every attempt; skip the retries and keep the
      // job in the failed set for inspection.
      throw new UnrecoverableError(`Invalid click payload: ${parsed.error.message}`);
    }
    try {
      return await this.ingest.ingest(parsed.data);
    } catch (error) {
      if (error instanceof UnknownLinkError) throw new UnrecoverableError(error.message);
      // Anything else (DB down, timeout, deadlock) is retried with backoff by BullMQ.
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const final =
      !job || job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError;
    this.logger[final ? 'error' : 'warn'](
      { err: error, jobId: job?.id, attemptsMade: job?.attemptsMade },
      final ? 'Click job failed permanently' : 'Click job failed, will retry',
    );
  }
}
