import { defineConfig } from 'vitest/config';

// Node environment on purpose: these tests cover the pure browser-side
// evaluation helpers (local-eval, condition value parsing), not rendered DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
