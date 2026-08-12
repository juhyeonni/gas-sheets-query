import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      // Floor locked just below the current baseline (#86); ratchet up over time.
      thresholds: {
        statements: 74,
        branches: 78,
        functions: 80,
        lines: 73
      }
    }
  },
})
