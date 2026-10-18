import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CLICK_QUEUE } from '@short-link/contracts';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ClickRecorder } from './click-recorder.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: CLICK_QUEUE,
      defaultJobOptions: {
        // Retries cover transient DB errors in the worker; processing is idempotent, so a
        // retry after a partial failure cannot double count.
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        // Completed jobs carry no information the database doesn't already have.
        removeOnComplete: { age: 3_600, count: 10_000 },
        // Failed jobs are kept a week for inspection and manual retry.
        removeOnFail: { age: 7 * 24 * 3_600 },
      },
    }),
  ],
  controllers: [AnalyticsController],
  providers: [ClickRecorder, AnalyticsService],
  exports: [ClickRecorder],
})
export class AnalyticsModule {}
