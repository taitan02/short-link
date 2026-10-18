import Bowser from 'bowser';

export const DEVICE_TYPES = ['desktop', 'mobile', 'tablet', 'tv', 'bot', 'unknown'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface ClientInfo {
  deviceType: DeviceType;
  browser: string;
  os: string;
}

const UNKNOWN: ClientInfo = { deviceType: 'unknown', browser: 'Other', os: 'Other' };

function isDeviceType(value: string | undefined): value is DeviceType {
  return DEVICE_TYPES.some((type) => type === value);
}

/**
 * Link-preview fetchers (Slack, Facebook, ...) and crawlers come out as `bot`. They still count
 * as clicks, but under their own device type, so dashboards can tell them apart from people.
 */
export function parseUserAgent(userAgent: string | null): ClientInfo {
  // bowser throws on an empty string.
  if (!userAgent?.trim()) return UNKNOWN;

  const { browser, os, platform } = Bowser.parse(userAgent);
  return {
    deviceType: isDeviceType(platform.type) ? platform.type : 'unknown',
    browser: browser.name?.slice(0, 64) || 'Other',
    os: os.name?.slice(0, 64) || 'Other',
  };
}
