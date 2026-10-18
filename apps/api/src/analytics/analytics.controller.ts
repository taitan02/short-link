import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.decorators';
import { CurrentUser } from '../auth/auth.decorators';
import { AnalyticsQueryDto, LinkAnalyticsDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('api/links')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id/analytics')
  forLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AnalyticsQueryDto,
  ): Promise<LinkAnalyticsDto> {
    return this.analytics.forLink(user.id, id, query);
  }
}
