import { parseUserAgent } from './user-agent';

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      { deviceType: 'mobile', browser: 'Safari', os: 'iOS' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { deviceType: 'desktop', browser: 'Chrome', os: 'Windows' },
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      { deviceType: 'tablet', browser: 'Safari', os: 'iOS' },
    ],
  ])('classifies %s', (userAgent, expected) => {
    expect(parseUserAgent(userAgent)).toEqual(expected);
  });

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  ])('marks %s as a bot', (userAgent) => {
    expect(parseUserAgent(userAgent).deviceType).toBe('bot');
  });

  it.each([null, '', '   '])('treats %p as unknown', (userAgent) => {
    expect(parseUserAgent(userAgent)).toEqual({
      deviceType: 'unknown',
      browser: 'Other',
      os: 'Other',
    });
  });

  it('never returns an empty browser name', () => {
    expect(parseUserAgent('curl/8.4.0').browser).not.toBe('');
  });
});
