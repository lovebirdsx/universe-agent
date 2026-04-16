import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    include: ['**/*.int.test.ts', '**/*.int.test.tsx'],
    exclude: ['**/node_modules/**'],
  },
});
