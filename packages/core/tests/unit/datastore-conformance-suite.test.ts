/**
 * Tests of the conformance suite itself (#195): it must catch a broken store,
 * keep running its other cases when one fails, and stay free of any test
 * runner so `@gsquery/core/testing` can be loaded outside vitest.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { applyQuery } from '../../src/core/query-utils'
import { assertClientIdsAvailable } from '../../src/core/client-ids'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { runDataStoreConformance } from '../../src/testing'
import type { ConformanceRow, DataStoreFactory } from '../../src/testing'
import type { DataStore, IdMode, QueryOptions, UpdateData } from '../../src/core/types'

/** A runner that runs each case at once and records whether it threw. */
function collectingRunner() {
  const results: { title: string; error?: unknown }[] = []
  const path: string[] = []
  return {
    results,
    describe(name: string, body: () => void) {
      path.push(name)
      try {
        body()
      } finally {
        path.pop()
      }
    },
    it(name: string, body: () => void) {
      const title = [...path, name].join(' > ')
      try {
        body()
        results.push({ title })
      } catch (error) {
        results.push({ title, error })
      }
    },
  }
}

/**
 * A minimal array-backed store that gets everything right except one thing:
 * `update` lets the payload overwrite the row's id.
 */
class IdLeakingStore implements DataStore<ConformanceRow> {
  private rows: ConformanceRow[]
  private nextId: number

  constructor(readonly idMode: IdMode, seed: ConformanceRow[]) {
    this.rows = [...seed]
    this.nextId = seed.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  }

  private ids(): Map<string | number, number> {
    return new Map(this.rows.map((row, i) => [row.id, i]))
  }

  private positionOf(id: string | number): number {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].id === id) return i
    }
    return -1
  }

  findAll(): ConformanceRow[] {
    return [...this.rows]
  }

  find(options: QueryOptions<ConformanceRow>): ConformanceRow[] {
    return applyQuery(this.rows, options.where, options)
  }

  findById(id: string | number): ConformanceRow | undefined {
    const pos = this.positionOf(id)
    return pos === -1 ? undefined : this.rows[pos]
  }

  insert(data: ConformanceRow | Omit<ConformanceRow, 'id'>): ConformanceRow {
    let row: ConformanceRow
    if (this.idMode === 'client') {
      if (!('id' in data)) throw new Error('ID is required')
      assertClientIdsAvailable(this.ids(), [data.id])
      row = data
    } else {
      row = { ...data, id: this.nextId++ }
    }
    this.rows.push(row)
    return row
  }

  update(id: string | number, data: UpdateData<ConformanceRow>): ConformanceRow | undefined {
    const pos = this.positionOf(id)
    if (pos === -1) return undefined
    // The defect under test: no `id: old.id` after the spread.
    const row = { ...this.rows[pos], ...data }
    this.rows[pos] = row
    return row
  }

  delete(id: string | number): boolean {
    const pos = this.positionOf(id)
    if (pos === -1) return false
    this.rows.splice(pos, 1)
    return true
  }
}

const createLeaking: DataStoreFactory = ({ idMode, seed }) => ({
  store: new IdLeakingStore(idMode, seed),
})

describe('runDataStoreConformance [#195]', () => {
  it('fails only the id-immutability cases of a store whose update changes the id, and runs the rest', () => {
    const runner = collectingRunner()
    runDataStoreConformance({ name: 'IdLeakingStore', create: createLeaking, ...runner })

    const failed = runner.results.filter(r => r.error !== undefined)
    const passed = runner.results.filter(r => r.error === undefined)

    expect(failed.length).toBeGreaterThan(0)
    for (const { title, error } of failed) {
      expect(title, String(error)).toMatch(/id immutability/)
      expect(error).toBeInstanceOf(Error)
    }
    // Both id modes ran their CRUD, empty-cell and index-parity clauses.
    for (const mode of ['auto', 'client']) {
      const ofMode = passed.filter(r => r.title.includes(`(${mode} ids)`))
      expect(ofMode.some(r => /empty cells/.test(r.title))).toBe(true)
      expect(ofMode.some(r => /index parity/.test(r.title))).toBe(true)
      expect(ofMode.some(r => /crud/.test(r.title))).toBe(true)
    }
    expect(passed.some(r => /client ids/.test(r.title))).toBe(true)
    expect(passed.some(r => /auto ids:/.test(r.title))).toBe(true)
  })

  it('skips the batch and count clauses for a store without those methods', () => {
    const runner = collectingRunner()
    runDataStoreConformance({ name: 'IdLeakingStore', create: createLeaking, ...runner })

    expect(runner.results.some(r => /batch|count/i.test(r.title))).toBe(false)
  })

  it('passes every case on MockAdapter, batch and count clauses included', () => {
    const runner = collectingRunner()
    const create: DataStoreFactory = ({ idMode, seed, indexes }) => {
      const store = new MockAdapter<ConformanceRow>({ initialData: seed, indexes, idMode })
      // MockAdapter has no count(); give it one so the clause is exercised here.
      return { store: Object.assign(store, { count: () => store.findAll().length }) }
    }
    runDataStoreConformance({ name: 'MockAdapter', create, ...runner })

    expect(runner.results.filter(r => r.error !== undefined)).toEqual([])
    for (const clause of [/batchInsert/, /batchUpdate/, /batchDelete/, /count/]) {
      expect(runner.results.some(r => clause.test(r.title))).toBe(true)
    }
  })

  it('calls the cleanup of every store it opened, after every case', () => {
    let open = 0
    let cleaned = 0
    const runner = collectingRunner()
    runDataStoreConformance({
      name: 'MockAdapter',
      create: ({ idMode, seed, indexes }) => {
        open++
        return {
          store: new MockAdapter<ConformanceRow>({ initialData: seed, indexes, idMode }),
          cleanup: () => {
            cleaned++
          },
        }
      },
      ...runner,
    })

    expect(open).toBeGreaterThan(runner.results.length)
    expect(cleaned).toBe(open)
  })

  it('runs only the id modes it is given', () => {
    const runner = collectingRunner()
    runDataStoreConformance({ name: 'MockAdapter', create: createLeaking, idModes: ['client'], ...runner })

    expect(runner.results.length).toBeGreaterThan(0)
    expect(runner.results.every(r => r.title.includes('(client ids)'))).toBe(true)
  })
})

// ── The testing subpath must not load a test runner (AC1) ────────────────

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Every module specifier `file` imports, statically or dynamically. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/\b(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1])
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1])
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/** Bare (package) specifiers reachable from `entry` through relative imports. */
function packagesReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importSpecifiers(readFileSync(file, 'utf-8'))) {
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      } else {
        packages.add(specifier)
      }
    }
  }
  return packages
}

describe('@gsquery/core/testing stays runner-free [#195]', () => {
  it('exports runDataStoreConformance', async () => {
    const testing = await import('../../src/testing')
    expect(typeof testing.runDataStoreConformance).toBe('function')
  })

  it('reaches no vitest module from its source entry point', () => {
    const packages = packagesReachableFrom(join(packageRoot, 'src', 'testing', 'index.ts'))
    expect([...packages].filter(name => /vitest/.test(name))).toEqual([])
  })

  const builtTesting = join(packageRoot, 'dist', 'testing.mjs')
  it.skipIf(!existsSync(builtTesting))('ships a bundle that imports no vitest module', async () => {
    const source = readFileSync(builtTesting, 'utf-8')
    expect(importSpecifiers(source).filter(name => /vitest/.test(name))).toEqual([])
    const built = await import(pathToFileURL(builtTesting).href)
    expect(typeof built.runDataStoreConformance).toBe('function')
  })
})
