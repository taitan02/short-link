// Tests never read .env files; everything they need is set explicitly here.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
