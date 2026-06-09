import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared word-popup module lives in the extension package so it can also
      // be loaded as a content script; the web app imports the same source.
      '@popup': fileURLToPath(new URL('../extension/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Allow importing the shared popup module from ../extension/shared (outside
    // the client/ root).
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    setupFiles: './src/test/setup.ts',
  },
});
