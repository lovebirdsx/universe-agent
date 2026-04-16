import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.int.test.ts', '**/*.int.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
  },
});
