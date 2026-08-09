import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Match build.mjs: resolve @gsquery/core to workspace SOURCE so the local
// check exercises the same code the GAS bundle ships, independent of any
// stale packages/core/dist on the machine.
export default defineConfig({
  resolve: {
    alias: {
      '@gsquery/core/testing': resolve(__dirname, '../../packages/core/src/testing/index.ts'),
      '@gsquery/core': resolve(__dirname, '../../packages/core/src/index.ts')
    }
  },
  test: {
    include: ['local-check.test.ts']
  }
})
