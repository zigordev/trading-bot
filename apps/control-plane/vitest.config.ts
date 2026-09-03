import { defineConfig } from 'vitest/config';

/**
 * Vitest, not `node:test` — one runner across the estate.
 *
 * No SWC plugin here: this is Fastify, not Nest, so nothing depends on
 * `emitDecoratorMetadata` and Vitest's default esbuild transform is enough.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
