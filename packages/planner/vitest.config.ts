import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // esbuild's first transform pays a binary-startup cost.
    testTimeout: 20_000,
  },
});
