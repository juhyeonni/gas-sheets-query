import { copyFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

// Single-file IIFE bundle: GAS has no module system. The library and the
// harness are bundled together so the deployed project needs no dependencies.
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/Code.js',
  format: 'iife',
  globalName: 'GasE2E',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: false
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
