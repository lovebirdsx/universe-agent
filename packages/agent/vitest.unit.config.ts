import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts', '**/*.int.test.tsx'],
  },
});
