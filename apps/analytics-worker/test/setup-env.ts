import { testDatabaseUrl, testRedisUrl } from './test-env';

// Tests never read .env files; everything they need is set explicitly here, overriding
// whatever the shell exported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.QUEUE_REDIS_URL = testRedisUrl();
