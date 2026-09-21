import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Project definitions live in vitest.workspace.mts: the unit project must stay
// free of any database setup so the pure domain rules run in milliseconds.
export default defineConfig({
  plugins: [tsconfigPaths()],
});
