import { Module } from '@nestjs/common';
import { LinkCacheService } from './link-cache.service';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { ShortCodeGenerator } from './short-code';

@Module({
  controllers: [LinksController],
  providers: [LinksService, ShortCodeGenerator, LinkCacheService],
  exports: [LinkCacheService],
})
export class LinksModule {}
