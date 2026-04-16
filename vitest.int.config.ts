import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.int.config.ts', 'apps/*/vitest.int.config.ts'],
  },
});
