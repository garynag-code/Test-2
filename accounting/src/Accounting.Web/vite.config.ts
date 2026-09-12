import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI is served locally and talks to the local API host; no external services are used.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5080', changeOrigin: true },
      '/login': { target: 'http://localhost:5080', changeOrigin: true },
    },
  },
});
