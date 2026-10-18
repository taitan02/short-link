import { BlockList, isIP } from 'node:net';

export const MAX_URL_LENGTH = 2048;

export interface DestinationPolicy {
  publicOrigin: string;
  /** Lowercased hostnames; subdomains are matched too. */
  blockedHosts: readonly string[];
}

export type DestinationUrlResult = { ok: true; url: string } | { ok: false; reason: string };

// Addresses that are never a legitimate public destination. A short link to them is either a
// mistake or an attempt to aim visitors' browsers at their own network (router admin pages etc.).
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
// IPv4 rules also match IPv4-mapped IPv6 (::ffff:127.0.0.1); adding ::ffff:0:0/96 here would
// instead block every IPv4 address.
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

function hostMatches(hostname: string, blocked: string): boolean {
  return hostname === blocked || hostname.endsWith(`.${blocked}`);
}

/**
 * Returns the WHATWG-normalized URL (lowercased host, punycode, percent-encoding, numeric IPv4
 * forms like http://2130706433/ rewritten to dotted quads) so what is stored and checked is
 * exactly what browsers will follow. No network requests are made, so there is no SSRF surface.
 */
export function parseDestinationUrl(raw: string, policy: DestinationPolicy): DestinationUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'url must be an absolute URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'url must use http or https' };
  }
  // https://trusted.com@evil.com/ is a classic phishing disguise.
  if (url.username || url.password) {
    return { ok: false, reason: 'url must not contain credentials' };
  }

  // Brackets wrap IPv6 literals; a trailing dot ("localhost.") is the same host.
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ipVersion = isIP(hostname);
  if (ipVersion) {
    if (NON_PUBLIC_ADDRESSES.check(hostname, ipVersion === 4 ? 'ipv4' : 'ipv6')) {
      return { ok: false, reason: 'url must point to a public address' };
    }
  } else if (!hostname.includes('.') || hostMatches(hostname, 'localhost')) {
    return { ok: false, reason: 'url must point to a public address' };
  }

  // Short links pointing at our own domain enable redirect loops and laundering of
  // disabled/blocked links through a fresh code.
  if (hostname === new URL(policy.publicOrigin).hostname) {
    return { ok: false, reason: 'url must not point to this service' };
  }
  if (policy.blockedHosts.some((blocked) => hostMatches(hostname, blocked))) {
    return { ok: false, reason: 'url points to a blocked domain' };
  }
  if (url.href.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `url must be at most ${MAX_URL_LENGTH} characters` };
  }
  return { ok: true, url: url.href };
}
