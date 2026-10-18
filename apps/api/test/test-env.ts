const DEFAULT_TEST_DATABASE_URL = 'postgresql://shortlink:shortlink@localhost:5442/shortlink_test';

// Tests truncate tables, so this is the one thing standing between `pnpm test:e2e` and a
// wiped dev or production database.
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${name}": name must end in _test`);
  }
  return url;
}

const DEFAULT_TEST_REDIS_URL = 'redis://localhost:6389/15';

// Same idea for Redis, which tests FLUSHDB between cases: only logical database 15 is allowed.
export function testRedisUrl(): string {
  const url = process.env.TEST_REDIS_URL ?? DEFAULT_TEST_REDIS_URL;
  if (new URL(url).pathname !== '/15') {
    throw new Error('Refusing to run tests against Redis: TEST_REDIS_URL must select database 15');
  }
  return url;
}
