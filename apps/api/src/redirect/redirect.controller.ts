import { Controller, Get, Header, Headers, HttpStatus, Param, Redirect } from '@nestjs/common';
import { ApiFoundResponse, ApiGoneResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { ClickRecorder } from '../analytics/click-recorder.service';
import { Public } from '../auth/auth.decorators';
import { RedirectService } from './redirect.service';

// Throttled per IP by the default limit; generous because one NAT can front many visitors.
@Public()
@ApiTags('redirect')
@Controller()
export class RedirectController {
  constructor(
    private readonly redirects: RedirectService,
    private readonly clicks: ClickRecorder,
  ) {}

  // 302, not 301: browsers cache 301s indefinitely, so a later disable/edit would never be
  // seen and repeat clicks would bypass analytics. no-store keeps intermediaries honest too.
  @Get(':code')
  @Redirect(undefined, HttpStatus.FOUND)
  @Header('Cache-Control', 'no-store')
  @ApiFoundResponse({ description: 'Redirects to the destination URL' })
  @ApiNotFoundResponse({ description: 'Unknown or deleted code' })
  @ApiGoneResponse({ description: 'Link disabled or expired' })
  async redirect(
    @Param('code') code: string,
    @Headers('referer') referer?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const link = await this.redirects.resolve(code);
    // Only successful redirects count as clicks; 404/410 responses are not recorded.
    this.clicks.record({ shortLinkId: link.id, referer, userAgent });
    return { url: link.originalUrl };
  }
}
