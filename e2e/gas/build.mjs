import { copyFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))

// Single-file IIFE bundle: GAS has no module system. The library and the
// harness are bundled together so the deployed project needs no dependencies.
//
// IMPORTANT: '@gsquery/core' is aliased to the workspace SOURCE, not the
// package entry. The package entry resolves to packages/core/dist, and a
// stale local dist would silently deploy an old library to GAS — which is
// exactly what happened on the first real run (three "missing fix" failures
// that were really a stale bundle).
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/Code.js',
  format: 'iife',
  globalName: 'GasE2E',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: false,
  alias: {
    '@gsquery/core': resolve(here, '../../packages/core/src/index.ts')
  }
})

// GAS discovers entrypoints as top-level function declarations; re-export the
// bundle's entrypoints as plain functions.
appendFileSync(
  'dist/Code.js',
  [
    '',
    'function doGet(e) { return GasE2E.doGet(e) }',
    'function runAllTests() { return GasE2E.runAllTests() }',
    ''
  ].join('\n')
)

mkdirSync('dist', { recursive: true })
copyFileSync('appsscript.json', 'dist/appsscript.json')

writeFileSync(
  'dist/.claspignore',
  ['**/**', '!Code.js', '!appsscript.json', ''].join('\n')
)

console.log('e2e/gas: bundled dist/Code.js + appsscript.json')
