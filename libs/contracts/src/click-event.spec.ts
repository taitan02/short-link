import { clickEventV1 } from './click-event';

const valid = {
  v: 1,
  eventId: '01a14e89-743f-722a-88c1-559ad54a843e',
  shortLinkId: '01a14e89-73dc-7498-9c63-4311c0c03034',
  clickedAt: '2026-10-18T10:23:13.471Z',
  referrerHost: 'news.ycombinator.com',
  userAgent: 'Mozilla/5.0',
};

describe('clickEventV1', () => {
  it('accepts a well-formed event', () => {
    expect(clickEventV1.parse(valid)).toEqual(valid);
  });

  it('accepts missing referrer and user agent as null', () => {
    expect(clickEventV1.safeParse({ ...valid, referrerHost: null, userAgent: null }).success).toBe(
      true,
    );
  });

  it.each([
    ['unknown version', { v: 2 }],
    ['non-uuid event id', { eventId: 'abc' }],
    ['non-uuid link id', { shortLinkId: 'abc' }],
    ['non-ISO timestamp', { clickedAt: 'yesterday' }],
    ['oversized user agent', { userAgent: 'x'.repeat(513) }],
  ])('rejects %s', (_, override) => {
    expect(clickEventV1.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('rejects a payload missing required fields', () => {
    const withoutLink: Record<string, unknown> = { ...valid };
    delete withoutLink.shortLinkId;
    expect(clickEventV1.safeParse(withoutLink).success).toBe(false);
  });
});
