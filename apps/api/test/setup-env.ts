import { testDatabaseUrl } from './test-env';

// Tests never read .env files; everything they need is set explicitly here, overriding
// whatever the shell exported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.PUBLIC_BASE_URL = 'https://sho.rt';
process.env.DATABASE_URL = testDatabaseUrl();
