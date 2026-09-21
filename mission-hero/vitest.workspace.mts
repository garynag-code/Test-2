import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// The integration project talks to a real database; TEST_DATABASE_URL comes
// from .env so a developer's own database is never touched by a test run.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? '';

const serverOnlyShim = fileURLToPath(new URL('./src/test/server-only-shim.ts', import.meta.url));

export default defineWorkspace([
  {
    plugins: [tsconfigPaths()],
    test: {
      name: 'unit',
      environment: 'node',
      include: ['src/domain/**/*.test.ts', 'src/lib/**/*.test.ts'],
    },
  },
  {
    plugins: [tsconfigPaths()],
    resolve: { alias: { 'server-only': serverOnlyShim } },
    test: {
      name: 'integration',
      environment: 'node',
      include: ['src/features/**/*.test.ts', 'src/server/**/*.test.ts'],
      globalSetup: ['src/test/global-setup.ts'],
      setupFiles: ['src/test/setup-integration.ts'],
      // Integration tests share one PostgreSQL database; a single fork keeps
      // truncation between tests deterministic.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 30_000,
      hookTimeout: 120_000,
      env: {
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        NODE_ENV: 'test',
      },
    },
  },
]);
