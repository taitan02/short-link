import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_URL_LENGTH } from './destination-url';
import { SHORT_CODE_PATTERN } from './short-code';

export class CreateLinkDto {
  /** Destination URL (http or https). */
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  url!: string;

  /** Custom alias; a random 7-character code is generated when omitted. */
  @IsOptional()
  @Matches(SHORT_CODE_PATTERN, {
    message: 'alias must be 3-32 characters of letters, digits, "-" or "_"',
  })
  alias?: string;

  /** Must be in the future. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class UpdateLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  url?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Send null to remove the expiration (IsOptional lets null through). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}

export const LINK_STATUSES = ['active', 'inactive', 'expired'] as const;
export const LINK_SORT_FIELDS = ['createdAt', 'expiresAt'] as const;

export class ListLinksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  /** active = enabled and not expired; inactive = disabled; expired = past expiresAt. */
  @IsOptional()
  @IsIn(LINK_STATUSES)
  status?: (typeof LINK_STATUSES)[number];

  /** Case-insensitive match on code or destination URL. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @IsIn(LINK_SORT_FIELDS)
  sortBy: (typeof LINK_SORT_FIELDS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

export class LinkResponseDto {
  id!: string;
  code!: string;
  shortUrl!: string;
  originalUrl!: string;
  isActive!: boolean;
  expiresAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class LinkPageDto {
  items!: LinkResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}
