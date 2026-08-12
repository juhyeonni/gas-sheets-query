import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/core/types.ts', 'src/testing/index.ts'],
      // Floor locked just below the current baseline (#86); ratchet up over time.
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 94,
        lines: 93
      }
    }
  }
})
