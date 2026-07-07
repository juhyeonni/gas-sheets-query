import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      // Floor locked just below the current baseline (#86); ratchet up over time.
      thresholds: {
        statements: 45,
        branches: 42,
        functions: 48,
        lines: 43
      }
    },
  },
})
