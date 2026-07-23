import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The wasm module loads + boots per test; give it headroom.
    testTimeout: 30_000,
  },
});
