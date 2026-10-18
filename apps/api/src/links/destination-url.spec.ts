import { DestinationPolicy, MAX_URL_LENGTH, parseDestinationUrl } from './destination-url';

const POLICY: DestinationPolicy = {
  publicOrigin: 'https://sho.rt',
  blockedHosts: ['evil.example', 'bit.ly'],
};

const parse = (url: string) => parseDestinationUrl(url, POLICY);

describe('parseDestinationUrl', () => {
  it('normalizes a valid URL', () => {
    expect(parse('  HTTPS://Example.COM/path?q=1 ')).toEqual({
      ok: true,
      url: 'https://example.com/path?q=1',
    });
  });

  it('converts IDN hosts to punycode', () => {
    expect(parse('https://bücher.de')).toEqual({ ok: true, url: 'https://xn--bcher-kva.de/' });
  });

  it.each(['https://8.8.8.8/', 'https://[2606:4700:4700::1111]/'])(
    'accepts public IP literal %s',
    (url) => {
      expect(parse(url).ok).toBe(true);
    },
  );

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
    ['https://evil.example/login', 'blocked domain'],
    ['https://Login.EVIL.example/', 'blocked domain'],
    ['https://bit.ly/abc', 'blocked domain'],
    ['http://localhost:3000/', 'public address'],
    ['http://LOCALHOST./', 'public address'],
    ['http://app.localhost/', 'public address'],
    ['http://intranet/', 'public address'],
    ['http://127.0.0.1/', 'public address'],
    ['http://2130706433/', 'public address'],
    ['http://0x7f.1/', 'public address'],
    ['http://10.1.2.3/', 'public address'],
    ['http://172.20.0.1/', 'public address'],
    ['http://192.168.1.1/admin', 'public address'],
    ['http://169.254.169.254/latest/meta-data', 'public address'],
    ['http://[::1]/', 'public address'],
    ['http://[fd00::1]/', 'public address'],
    ['http://[::ffff:127.0.0.1]/', 'public address'],
  ])('rejects %s', (input, reason) => {
    const result = parse(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain(reason);
  });

  it('does not block domains that merely end with a blocked name', () => {
    expect(parse('https://notevil.example/').ok).toBe(true);
  });

  it('rejects URLs longer than the limit after normalization', () => {
    expect(parse(`https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`).ok).toBe(false);
  });
});
