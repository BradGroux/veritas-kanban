import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/__tests__/**',
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
