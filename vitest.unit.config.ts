import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.unit.config.ts', 'apps/*/vitest.unit.config.ts'],
  },
});
