import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: isSsrBuild ? [] : [react(), tailwindcss()],
  build: isSsrBuild
    ? {
        // Server bundle: `vite build --ssr src/server/index.ts` -> dist/server/index.js
        outDir: 'dist/server',
        target: 'node22',
        sourcemap: true,
        emptyOutDir: true,
      }
    : {
        outDir: 'dist/client',
        emptyOutDir: true,
      },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
