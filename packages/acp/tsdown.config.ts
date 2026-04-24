import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm', 'cjs'],
    dts: false,
    clean: false,
    deps: {
      alwaysBundle: ['dotenv/config'],
    },
  },
]);
