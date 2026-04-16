import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    root: 'src',
    environment: 'happy-dom',
    include: ['**/*.int.test.ts', '**/*.int.test.tsx'],
    passWithNoTests: true,
  },
});
