import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['server', 'web', 'mcp'],
  },
});
