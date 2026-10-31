import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const backend = 'http://localhost:3000';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: { alias: { '@engine': path.resolve(import.meta.dirname, '../server/engine') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/overlays': backend,
      '/events': backend,
      '/ws': { target: backend, ws: true },
    },
  },
});
