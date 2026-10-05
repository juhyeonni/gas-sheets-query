import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Compile-time contracts (#246): `*.test-d.ts` files are checked by tsc,
    // never executed, so a `@ts-expect-error` that stops matching fails the
    // run. The packages' own `tsc` pass excludes tests, and Vitest strips
    // types from ordinary tests, so neither would notice.
    typecheck: {
      enabled: true,
      include: ['tests/types/**/*.test-d.ts'],
      tsconfig: './tsconfig.type-tests.json'
    },
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
