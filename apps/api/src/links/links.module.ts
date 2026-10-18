import { Module } from '@nestjs/common';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { ShortCodeGenerator } from './short-code';

@Module({
  controllers: [LinksController],
  providers: [LinksService, ShortCodeGenerator],
  exports: [LinksService],
})
export class LinksModule {}
