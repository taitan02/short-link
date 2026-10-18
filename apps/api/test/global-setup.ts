import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './test-env';

export default function globalSetup() {
  execFileSync('pnpm', ['--filter', '@short-link/prisma', 'exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
