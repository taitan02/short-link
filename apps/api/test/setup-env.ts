import { testDatabaseUrl, testRedisUrl } from './test-env';

// Tests never read .env files; everything they need is set explicitly here, overriding
// whatever the shell exported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.PUBLIC_BASE_URL = 'https://sho.rt';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.QUEUE_REDIS_URL = testRedisUrl();
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
// Lets tests simulate distinct clients via X-Forwarded-For when exercising IP rate limits.
process.env.TRUST_PROXY_HOPS = '1';
process.env.CORS_ORIGINS = 'https://app.sho.rt';
process.env.BLOCKED_DESTINATION_HOSTS = 'evil.example';
