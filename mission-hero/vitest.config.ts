import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
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
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/features/**/*.test.ts', 'src/server/**/*.test.ts'],
          setupFiles: ['src/test/setup-integration.ts'],
          globalSetup: ['src/test/global-setup.ts'],
          // Integration tests share one PostgreSQL database; running files in a
          // single fork keeps truncation between tests deterministic.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
