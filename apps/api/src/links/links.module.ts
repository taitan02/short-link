import { Module } from '@nestjs/common';
import { LinksService } from './links.service';
import { ShortCodeGenerator } from './short-code';

// HTTP management endpoints arrive with authentication (Phase 2): every operation is scoped to
// the authenticated owner, so exposing them earlier would mean shipping them unprotected.
@Module({
  providers: [LinksService, ShortCodeGenerator],
  exports: [LinksService],
})
export class LinksModule {}
