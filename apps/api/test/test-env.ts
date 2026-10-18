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
