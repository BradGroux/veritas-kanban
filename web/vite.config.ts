import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const viteAllowedHostsEnv = process.env.VITE_ALLOWED_HOSTS?.trim();
const viteAllowedHosts =
  viteAllowedHostsEnv && viteAllowedHostsEnv.length > 0
    ? viteAllowedHostsEnv === '*'
      ? true
      : viteAllowedHostsEnv
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean)
    : undefined;

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: false,
    setupFiles: [],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-dom/client'],
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-slot',
          ],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    host: process.env.VITE_HOST || undefined,
    port: 3000,
    allowedHosts: viteAllowedHosts,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
