import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/*.int.test.ts', '**/*.int.test.tsx'],
  },
});
