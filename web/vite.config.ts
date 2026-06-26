import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET || apiProxyTarget.replace(/^http/, 'ws');

export default defineConfig({
  // Support deployment under a sub-path (e.g., VITE_BASE_PATH=/kanban/)
  base: process.env.VITE_BASE_PATH || '/',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react(), tailwindcss() as any],
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
    testTimeout: 15_000,
  },
  build: {
    chunkSizeWarningLimit: 400,
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType !== 'html') return deps;
        return deps.filter((dep) => !dep.includes('vendor-dnd'));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@mantine/')) {
            return 'vendor-mantine';
          }
          if (
            id.includes('node_modules/@radix-ui/react-dialog/') ||
            id.includes('node_modules/@radix-ui/react-popover/') ||
            id.includes('node_modules/@radix-ui/react-select/') ||
            id.includes('node_modules/@radix-ui/react-tabs/') ||
            id.includes('node_modules/@radix-ui/react-tooltip/') ||
            id.includes('node_modules/@radix-ui/react-slot/')
          ) {
            return 'vendor-radix';
          }
          if (
            id.includes('node_modules/@dnd-kit/core/') ||
            id.includes('node_modules/@dnd-kit/sortable/') ||
            id.includes('node_modules/@dnd-kit/utilities/')
          ) {
            return 'vendor-dnd';
          }
          if (id.includes('node_modules/@tanstack/react-query/')) {
            return 'vendor-query';
          }
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
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
