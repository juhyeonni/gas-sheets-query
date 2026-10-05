import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    // Exact matches, so the subpath is not resolved under the root entry.
    alias: [
      { find: /^@gsquery\/core\/testing$/, replacement: resolve(__dirname, '../core/src/testing/index.ts') },
      { find: /^@gsquery\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      // Floor locked just below the current baseline (#86); ratchet up over time.
      // Baseline dropped when the local-first/sync surface merged in; raise as
      // its coverage improves.
      thresholds: {
        statements: 65,
        branches: 58,
        functions: 58,
        lines: 66
      }
    }
  },
})
