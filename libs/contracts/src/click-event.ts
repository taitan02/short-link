import { z } from 'zod';

/** BullMQ queue carrying one job per successful redirect. */
export const CLICK_QUEUE = 'clicks';
export const CLICK_JOB = 'click';

export const MAX_USER_AGENT_LENGTH = 512;

/**
 * Wire format between the API (producer) and the analytics worker (consumer). They deploy
 * independently, so jobs produced by one version must stay readable by the next: add optional
 * fields freely, and introduce `v: 2` (handled alongside v1) for anything incompatible.
 *
 * Deliberately excludes the client IP and the full referrer URL (paths and query strings
 * routinely carry tokens and personal data).
 */
export const clickEventV1 = z.object({
  v: z.literal(1),
  /** Producer-generated, so retries and duplicate deliveries can be recognized downstream. */
  eventId: z.uuid(),
  shortLinkId: z.uuid(),
  clickedAt: z.iso.datetime(),
  /** Host of the Referer header, lowercased; null when absent or not a valid URL. */
  referrerHost: z.string().max(255).nullable(),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).nullable(),
});

export type ClickEventV1 = z.infer<typeof clickEventV1>;
