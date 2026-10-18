// Imported first by redis-down.e2e-spec.ts: ConfigModule reads the environment when AppModule
// is first loaded, so this has to run before that import. Port 1 refuses connections at once.
process.env.REDIS_URL = 'redis://127.0.0.1:1/15';
process.env.QUEUE_REDIS_URL = 'redis://127.0.0.1:1/15';
