import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { RedirectController } from './redirect.controller';
import { RedirectService } from './redirect.service';

@Module({
  imports: [LinksModule],
  controllers: [RedirectController],
  providers: [RedirectService],
})
export class RedirectModule {}
