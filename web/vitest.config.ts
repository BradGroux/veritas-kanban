/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/__fixtures__/**',
        'src/**/fixtures/**',
        'src/**/generated/**',
        'src/**/*.generated.*',
        'src/**/types.ts',
        'src/types/**/*.ts',
      ],
      all: true,
    },
  },
});
