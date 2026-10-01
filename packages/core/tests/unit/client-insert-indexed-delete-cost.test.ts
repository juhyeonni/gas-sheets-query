import { describe, it, expect, vi, afterEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { IndexStore } from '../../src/core/index-store'
import type { RowWithId } from '../../src/core/types'

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

function findEq(adapter: MockAdapter<R>, f: string): R[] {
  return adapter.find({ where: [{ field: 'f', operator: '=', value: f }], orderBy: [] })
}

describe('MockAdapter client-mode insert and indexed delete cost (#235)', () => {
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
    const adapter = new MockAdapter<R>({ idMode: 'client', initialData })
    reads = 0

    adapter.insert({ id: 'new', f: 'a', value: 0 })
    expect(reads).toBe(0)

    adapter.batchInsert(Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, f: 'a' })))
    expect(reads).toBe(0)
  })

  it('indexed delete rewrites no index bucket', () => {
    const initialData: R[] = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      f: ['a', 'b', 'c'][i % 3],
      g: i % 2,
    }))
    const make = (indexes?: Array<{ fields: string[] }>) =>
      new MockAdapter<R>({ idMode: 'client', initialData: initialData.map(r => ({ ...r })), indexes })
    const adapter = make([{ fields: ['f'] }, { fields: ['f', 'g'] }])
    const scan = make()

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

  it('large-N probe: 20k client inserts and 10k indexed back-deletes stay linear', () => {
    const adapter = new MockAdapter<R>({ idMode: 'client', indexes: [{ fields: ['f'] }] })
    const N = 20_000

    let t = performance.now()
    for (let i = 0; i < N; i++) adapter.insert({ id: `id${i}`, f: i % 2 ? 'a' : 'b' })
    const insertMs = performance.now() - t
    expect(insertMs).toBeLessThan(3000)

    t = performance.now()
    for (let i = N - 1; i >= N / 2; i--) adapter.delete(`id${i}`)
    const deleteMs = performance.now() - t
    expect(deleteMs).toBeLessThan(3000)

    expect(adapter.findAll()).toHaveLength(N / 2)
    expect(findEq(adapter, 'a')).toEqual(adapter.findAll().filter(r => r.f === 'a'))
  }, 60_000)
})
