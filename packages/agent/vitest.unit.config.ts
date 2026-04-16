import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    exclude: ['**/*.int.test.ts', '**/*.int.test.tsx'],
  },
});
