import { describe, it, expect, vi, afterEach } from 'vitest'
import { IndexStore } from '@gsquery/core'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface R extends RowWithId {
  id: string | number
  f: string
  g?: number
  value?: number
}

afterEach(() => vi.restoreAllMocks())

/**
 * Count Set.prototype.add/clear calls made while `fn` runs. Patched by hand:
 * vi.spyOn would count its own bookkeeping Sets.
 */
function countSetWrites(fn: () => void): { adds: number; clears: number } {
  const { add, clear } = Set.prototype
  let adds = 0
  let clears = 0
  Set.prototype.add = function (this: Set<unknown>, v: unknown) { adds++; return add.call(this, v) }
  Set.prototype.clear = function (this: Set<unknown>) { clears++; return clear.call(this) }
  try {
    fn()
  } finally {
    Set.prototype.add = add
    Set.prototype.clear = clear
  }
  return { adds, clears }
}

function memoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
  }
}

function make(initialData: R[], indexes?: Array<{ fields: string[] }>): LocalAdapter<R> {
  return new LocalAdapter<R>({
    tableName: 'T',
    idMode: 'client',
    initialData,
    indexes,
    disableIDB: true,
    mutationStorage: memoryStorage(),
  })
}

function findEq(adapter: LocalAdapter<R>, f: string): R[] {
  return adapter.find({ where: [{ field: 'f', operator: '=', value: f }], orderBy: [] })
}

describe('LocalAdapter client-mode insert and indexed delete cost (#235)', () => {
  it('client-mode insert reads no existing row id', () => {
    let reads = 0
    const initialData = Array.from({ length: 1000 }, (_, i) => {
      const row = { f: 'a' } as R
      Object.defineProperty(row, 'id', {
        get() { reads++; return i },
        enumerable: true,
      })
      return row
    })
    const adapter = make(initialData)
    reads = 0

    adapter.insert({ id: 'new', f: 'a', value: 0 })
    expect(reads).toBe(0)

    adapter.batchInsert(Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, f: 'a' })))
    expect(reads).toBe(0)
  })

  it('indexed delete rewrites no index bucket', () => {
    const rows: R[] = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      f: ['a', 'b', 'c'][i % 3],
      g: i % 2,
    }))
    const adapter = make(rows.map(r => ({ ...r })), [{ fields: ['f'] }, { fields: ['f', 'g'] }])
    const scan = make(rows.map(r => ({ ...r })))

    const reindex = vi.spyOn(IndexStore.prototype, 'reindexAfterDelete')
    for (const id of [999, 0, 500]) {
      const { adds, clears } = countSetWrites(() => adapter.delete(id))
      expect(adds).toBe(0)
      expect(clears).toBe(0)
      scan.delete(id)
    }
    expect(reindex).not.toHaveBeenCalled()
    expect(findEq(adapter, 'a')).toEqual(findEq(scan, 'a'))
  })

  it('large-N probe: client inserts and indexed back-deletes on 100k rows stay fast', () => {
    // Seeded rows bypass the MutationQueue, whose per-push persistence is
    // O(queue length) and out of scope here; only 1k mutations are queued.
    const N = 100_000
    const M = 1_000
    const rows: R[] = Array.from({ length: N }, (_, i) => ({ id: `id${i}`, f: i % 2 ? 'a' : 'b' }))
    const adapter = make(rows, [{ fields: ['f'] }])

    let t = performance.now()
    for (let i = 0; i < M; i++) adapter.insert({ id: `new${i}`, f: 'a' })
    const insertMs = performance.now() - t
    expect(insertMs).toBeLessThan(3000)

    t = performance.now()
    for (let i = M - 1; i >= 0; i--) adapter.delete(`new${i}`)
    const deleteMs = performance.now() - t
    expect(deleteMs).toBeLessThan(3000)

    expect(adapter.findAll()).toHaveLength(N)
    expect(findEq(adapter, 'a')).toEqual(adapter.findAll().filter(r => r.f === 'a'))
  }, 60_000)
})
