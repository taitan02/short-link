export const MAX_URL_LENGTH = 2048;

export type DestinationUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Returns the WHATWG-normalized URL (lowercased host, punycode, percent-encoding) so what is
 * stored is exactly what browsers will follow. No network requests are made, so there is no
 * SSRF surface here.
 */
export function parseDestinationUrl(raw: string, publicOrigin: string): DestinationUrlResult {
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
  // Short links pointing at our own domain enable redirect loops and laundering of
  // disabled/blocked links through a fresh code.
  if (url.hostname === new URL(publicOrigin).hostname) {
    return { ok: false, reason: 'url must not point to this service' };
  }
  if (url.href.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `url must be at most ${MAX_URL_LENGTH} characters` };
  }
  return { ok: true, url: url.href };
}
