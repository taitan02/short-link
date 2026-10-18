import { validateEnv } from './env';

const REQUIRED = {
  PUBLIC_BASE_URL: 'https://sho.rt',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  REDIS_URL: 'redis://localhost:6379',
  QUEUE_REDIS_URL: 'redis://localhost:6379/1',
};

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected function to throw');
}

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv(REQUIRED)).toEqual({
      ...REQUIRED,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 3000,
      JWT_TTL_SECONDS: 3600,
      LINK_CACHE_TTL_SECONDS: 600,
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGINS: [],
      BLOCKED_DESTINATION_HOSTS: [],
    });
  });

  it('coerces PORT from string', () => {
    expect(validateEnv({ ...REQUIRED, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([['abc'], ['0'], ['70000'], ['3000.5']])('rejects invalid PORT %s', (port) => {
    expect(() => validateEnv({ ...REQUIRED, PORT: port })).toThrow(/PORT/);
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it.each(['DATABASE_URL', 'PUBLIC_BASE_URL', 'JWT_SECRET', 'REDIS_URL', 'QUEUE_REDIS_URL'])(
    'requires %s',
    (key) => {
      expect(() => validateEnv({ ...REQUIRED, [key]: undefined })).toThrow(new RegExp(key));
    },
  );

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...REQUIRED, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('parses comma-separated lists', () => {
    expect(
      validateEnv({
        ...REQUIRED,
        CORS_ORIGINS: 'https://app.sho.rt, http://localhost:5173',
        BLOCKED_DESTINATION_HOSTS: 'Evil.example,,bit.ly',
      }),
    ).toMatchObject({
      CORS_ORIGINS: ['https://app.sho.rt', 'http://localhost:5173'],
      BLOCKED_DESTINATION_HOSTS: ['evil.example', 'bit.ly'],
    });
  });

  it('rejects a malformed CORS origin', () => {
    expect(() => validateEnv({ ...REQUIRED, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });

  it('reduces PUBLIC_BASE_URL to its origin', () => {
    expect(
      validateEnv({ ...REQUIRED, PUBLIC_BASE_URL: 'https://sho.rt/some/path/' }),
    ).toMatchObject({ PUBLIC_BASE_URL: 'https://sho.rt' });
  });

  it('does not echo rejected values in the error message', () => {
    const error = captureError(() =>
      validateEnv({ ...REQUIRED, DATABASE_URL: 'mysql://user:super-secret@host/db' }),
    );
    expect(error.message).toMatch(/DATABASE_URL/);
    expect(error.message).not.toContain('super-secret');
  });
});
