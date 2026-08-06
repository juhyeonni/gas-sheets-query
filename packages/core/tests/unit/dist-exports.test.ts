/**
 * Regression guard for #134.
 *
 * `export { SomeInterface } from './mod'` type-checks and emits a *value*
 * re-export into dist/types/index.d.ts, but esbuild erases the type from
 * dist/index.mjs. Consumers then write `import { SomeInterface } from
 * '@gsquery/core'`, type-check cleanly, and crash at ESM link time with
 * "does not provide an export named". Every value export the .d.ts declares
 * must therefore exist on the built module.
 *
 * `verbatimModuleSyntax` in tsconfig.json catches this at compile time; this
 * test verifies the built artifacts themselves. It needs a prior `pnpm build`
 * and is skipped when dist/ is absent (CI always builds first).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dtsPath = join(packageRoot, 'dist', 'types', 'index.d.ts')
const modulePath = join(packageRoot, 'dist', 'index.mjs')
const built = existsSync(dtsPath) && existsSync(modulePath)

/** Names the .d.ts re-exports in value position (i.e. not via `export type`). */
function readDeclaredValueExports(source: string): string[] {
  const names: string[] = []

  // `export { a, b as c } from '...'` / `export { a, b }` — but not `export type { ... }`.
  for (const match of source.matchAll(/\bexport\s*(type\s+)?\{([^}]*)\}/g)) {
    if (match[1] !== undefined) continue
    for (const raw of match[2].split(',')) {
      const specifier = raw.trim()
      // Inline type modifier: `export { type Foo }` is already type-only.
      if (specifier === '' || specifier.startsWith('type ')) continue
      const parts = specifier.split(/\s+as\s+/)
      names.push((parts[1] ?? parts[0]).trim())
    }
  }

  // `export declare class Foo` / `export declare function foo` / `export declare const foo`
  for (const match of source.matchAll(
    /\bexport\s+declare\s+(?:abstract\s+)?(?:class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.push(match[1])
  }

  return [...new Set(names)]
}

describe.skipIf(!built)('built package exports', () => {
  it('declares no value export that the ESM bundle is missing', async () => {
    const declared = readDeclaredValueExports(readFileSync(dtsPath, 'utf-8'))
    const runtime = await import(modulePath)

    expect(declared.length).toBeGreaterThan(0)
    const missing = declared.filter((name) => !(name in runtime))
    expect(missing).toEqual([])
  })

  it('keeps type-only names out of value position', async () => {
    const source = readFileSync(dtsPath, 'utf-8')
    const declared = readDeclaredValueExports(source)
    const runtime = await import(modulePath)

    // The five names from #134: types, so absent at runtime and re-exported
    // by the .d.ts only via `export type`.
    const typeOnly = [
      'JoinConfig',
      'StoreResolver',
      'MockAdapterOptions',
      'SheetsAdapterOptions',
      'IndexDefinition'
    ]

    for (const name of typeOnly) {
      expect(source).toContain(name)
      expect(declared).not.toContain(name)
      expect(name in runtime).toBe(false)
    }
  })
})
