import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, minutes } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.decorators';
import { CurrentUser } from '../auth/auth.decorators';
import {
  CreateLinkDto,
  LinkPageDto,
  LinkResponseDto,
  ListLinksQueryDto,
  UpdateLinkDto,
} from './links.dto';
import { LinksService } from './links.service';

@ApiTags('links')
@ApiBearerAuth()
@Controller('api/links')
export class LinksController {
  constructor(private readonly links: LinksService) {}

  // Per account (see AppThrottlerGuard): caps how fast one account can mint spam links.
  @Post()
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLinkDto): Promise<LinkResponseDto> {
    return this.links.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListLinksQueryDto): Promise<LinkPageDto> {
    return this.links.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LinkResponseDto> {
    return this.links.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLinkDto,
  ): Promise<LinkResponseDto> {
    return this.links.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.links.remove(user.id, id);
  }
}
