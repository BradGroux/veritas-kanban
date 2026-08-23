import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.veritas-kanban/**'],
    globals: true,
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['src/**/*.ts', '../shared/src/utils/api-permissions.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        '../shared/src/**/*.d.ts',
        'src/__tests__/**',
        'src/scripts/**',
        'src/storage/sqlite/test-helpers.ts',
      ],
      all: true,
    },
  },
});
