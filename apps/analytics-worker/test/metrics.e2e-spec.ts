import { TestingModule } from '@nestjs/testing';
import { CLICK_JOB } from '@short-link/contracts';
import { PrismaService } from '@short-link/prisma';
import { Queue } from 'bullmq';
import { WorkerMetrics } from '../src/metrics';
import { clickEvent, createLink, createWorker, resetDatabase, waitForState } from './utils';

describe('Worker metrics (e2e)', () => {
  let worker: TestingModule;
  let prisma: PrismaService;
  let clicks: Queue;
  let metrics: WorkerMetrics;

  beforeAll(async () => {
    ({ worker, prisma, clicks } = await createWorker());
    metrics = worker.get(WorkerMetrics);
  });

  afterAll(async () => {
    await worker.close();
  });

  it('counts job outcomes, times them, and reports queue depth', async () => {
    await resetDatabase(worker);
    metrics.registry.resetMetrics();
    const link = await createLink(prisma);
    const event = clickEvent(link.id);

    await waitForState(await clicks.add(CLICK_JOB, event), ['completed']);
    await waitForState(await clicks.add(CLICK_JOB, event), ['completed']);
    await waitForState(await clicks.add(CLICK_JOB, { v: 1 }), ['failed']);

    const text = await metrics.registry.metrics();
    expect(text).toContain('click_jobs_total{result="recorded",app="analytics-worker"} 1');
    expect(text).toContain('click_jobs_total{result="duplicate",app="analytics-worker"} 1');
    expect(text).toContain('click_jobs_total{result="failed",app="analytics-worker"} 1');
    expect(text).toContain('click_job_duration_seconds_count{app="analytics-worker"} 2');
    expect(text).toMatch(
      /queue_jobs\{queue="clicks",state="failed",app="analytics-worker"\} [1-9]/,
    );
    expect(text).toContain('queue_jobs{queue="analytics-maintenance",state="waiting"');
  });
});
