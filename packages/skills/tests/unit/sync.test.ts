import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SKILLS_DIR } from '../../src/index.js'

const PKG_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
).version as string

const CORE_BARREL = join(SKILLS_DIR, '..', '..', 'core', 'src', 'index.ts')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return markdownFiles(path)
    return path.endsWith('.md') ? [path] : []
  })
}

/** Symbols the skill files tell an AI to import from @gsquery/core. */
function claimedSymbols(): Map<string, string[]> {
  const claimed = new Map<string, string[]>()
  for (const file of markdownFiles(SKILLS_DIR)) {
    const src = readFileSync(file, 'utf-8')
    for (const block of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@gsquery\/core'/g)) {
      for (const raw of block[1].split(',')) {
        const symbol = raw.trim().replace(/^type\s+/, '')
        if (!symbol) continue
        claimed.set(symbol, [...(claimed.get(symbol) ?? []), file])
      }
    }
  }
  return claimed
}

/** Symbols @gsquery/core actually re-exports from its barrel. */
function exportedSymbols(): Set<string> {
  const src = readFileSync(CORE_BARREL, 'utf-8')
  const exported = new Set<string>()
  for (const block of src.matchAll(/export\s*(?:type\s*)?\{([^}]+)\}/g)) {
    for (const raw of block[1].split(',')) {
      const symbol = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
      if (symbol) exported.add(symbol)
    }
  }
  const declared = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|interface|type|enum)\s+([A-Za-z0-9_]+)/g
  for (const match of src.matchAll(declared)) exported.add(match[1])
  return exported
}

describe('skill files stay in sync with the library', () => {
  it('never teaches a symbol @gsquery/core does not export', () => {
    const exported = exportedSymbols()
    expect(exported.size).toBeGreaterThan(0)

    const phantoms = [...claimedSymbols()]
      .filter(([symbol]) => !exported.has(symbol))
      .map(([symbol, files]) => `${symbol} (${[...new Set(files)].join(', ')})`)

    expect(phantoms, `skill files reference removed APIs:\n  ${phantoms.join('\n  ')}`).toEqual([])
  })

  it('stamps the current package version in every entry point', () => {
    const entryPoints = [
      join(SKILLS_DIR, 'gsquery', 'SKILL.md'),
      join(SKILLS_DIR, 'generic', 'gsquery-cheatsheet.md'),
    ]

    for (const file of entryPoints) {
      const src = readFileSync(file, 'utf-8')
      const stale = [...src.matchAll(/\b\d+\.\d+\.\d+(?:-[\w.]+)?\b/g)]
        .map((m) => m[0])
        .filter((v) => v !== PKG_VERSION)

      expect(stale, `${file} stamps ${stale.join(', ')} but package.json is ${PKG_VERSION}`).toEqual(
        [],
      )
    }
  })
})
