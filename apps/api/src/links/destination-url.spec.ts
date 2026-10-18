import { MAX_URL_LENGTH, parseDestinationUrl } from './destination-url';

const ORIGIN = 'https://sho.rt';

describe('parseDestinationUrl', () => {
  it('normalizes a valid URL', () => {
    expect(parseDestinationUrl('  HTTPS://Example.COM/path?q=1 ', ORIGIN)).toEqual({
      ok: true,
      url: 'https://example.com/path?q=1',
    });
  });

  it('converts IDN hosts to punycode', () => {
    expect(parseDestinationUrl('https://bücher.de', ORIGIN)).toEqual({
      ok: true,
      url: 'https://xn--bcher-kva.de/',
    });
  });

  it.each([
    ['not a url', 'absolute URL'],
    ['/relative/path', 'absolute URL'],
    ['javascript:alert(1)', 'http or https'],
    ['data:text/html,<script>alert(1)</script>', 'http or https'],
    ['ftp://example.com/file', 'http or https'],
    ['https://trusted.com@evil.com/', 'credentials'],
    ['https://user:pass@example.com/', 'credentials'],
    ['https://SHO.RT/abc', 'this service'],
    ['http://sho.rt:8080/abc', 'this service'],
  ])('rejects %s', (input, reason) => {
    const result = parseDestinationUrl(input, ORIGIN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain(reason);
  });

  it('rejects URLs longer than the limit after normalization', () => {
    const url = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(parseDestinationUrl(url, ORIGIN).ok).toBe(false);
  });
});
