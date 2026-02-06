import * as esbuild from 'esbuild'

// ESM build
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.mjs',
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: true,
  external: []
})

// CJS build
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.cjs',
  format: 'cjs',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: true,
  external: []
})

// GAS build (single file, no modules)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/gas/bundle.js',
  format: 'iife',
  globalName: 'SheetsQuery',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: false
})

console.log('✅ Build complete')
