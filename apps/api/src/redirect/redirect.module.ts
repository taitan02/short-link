import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { LinksModule } from '../links/links.module';
import { RedirectController } from './redirect.controller';
import { RedirectService } from './redirect.service';

@Module({
  imports: [LinksModule, AnalyticsModule],
  controllers: [RedirectController],
  providers: [RedirectService],
})
export class RedirectModule {}
