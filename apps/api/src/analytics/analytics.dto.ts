import { IsOptional, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsQueryDto {
  /** First UTC day, inclusive (YYYY-MM-DD). Defaults to 29 days before `to`. */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a date in YYYY-MM-DD format' })
  from?: string;

  /** Last UTC day, inclusive (YYYY-MM-DD). Defaults to today. */
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a date in YYYY-MM-DD format' })
  to?: string;
}

export class DailyClicksDto {
  date!: string;
  clicks!: number;
}

export class BreakdownEntryDto {
  value!: string;
  clicks!: number;
}

export class LinkAnalyticsDto {
  from!: string;
  to!: string;
  totalClicks!: number;
  /** One entry per day in the range, zero-filled. */
  daily!: DailyClicksDto[];
  /** Top 10 referrer hosts; "(direct)" when there was no referrer. */
  referrers!: BreakdownEntryDto[];
  /** desktop, mobile, tablet, tv, bot or unknown. */
  devices!: BreakdownEntryDto[];
  /** Top 10 browsers. */
  browsers!: BreakdownEntryDto[];
}
