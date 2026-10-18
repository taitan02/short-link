import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env itself. Scripts run with cwd = libs/prisma; real environment
// variables (CI, containers) take precedence over the file.
const rootEnvFile = '../../.env';
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
