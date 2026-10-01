import { describe, it, expect } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type { IndexDefinition } from '@gsquery/core'
import type { RowWithId } from '@gsquery/core'

interface R extends RowWithId {
  id: number
  f?: unknown
  a?: unknown
  b?: unknown
}

function memoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
  }
}

function pair(rows: R[], indexes: IndexDefinition[]) {
  const copy = () => rows.map(r => ({ ...r }))
  const make = (idx?: IndexDefinition[]) =>
    new LocalAdapter<R>({
      tableName: 'T',
      initialData: copy(),
      indexes: idx,
      idMode: 'client',
      disableIDB: true,
      mutationStorage: memoryStorage(),
    })
  return { indexed: make(indexes), scan: make() }
}

function findEq(adapter: LocalAdapter<R>, ...conds: Array<[string, unknown]>) {
  return adapter.find({
    where: conds.map(([field, value]) => ({ field, operator: '=' as const, value })),
    orderBy: [],
  })
}

describe('LocalAdapter: indexed find parity with scan (#239)', () => {
  it('indexed find equals unindexed find after updates reorder index sets', () => {
    const rows: R[] = [1, 2, 3, 4, 5].map(id => ({ id, f: id === 3 || id === 4 ? 'x' : 'o' }))
    const { indexed, scan } = pair(rows, [{ fields: ['f'] }])
    for (const a of [indexed, scan]) {
      a.update(3, { f: 'y' })
      a.update(3, { f: 'x' })
    }
    const got = findEq(indexed, ['f', 'x'])
    expect(got).toEqual(findEq(scan, ['f', 'x']))
    expect(got.map(r => r.id)).toEqual([3, 4])
  })

  it('indexed = null does not match undefined/missing fields', () => {
    const rows: R[] = [{ id: 1 }, { id: 2, f: null }, { id: 3, f: 'a' }]
    const { indexed, scan } = pair(rows, [{ fields: ['f'] }])
    const got = findEq(indexed, ['f', null])
    expect(got).toEqual(findEq(scan, ['f', null]))
    expect(got.map(r => r.id)).toEqual([2])
  })

  it('indexed Date equality does not match the ISO string', () => {
    const rows: R[] = [
      { id: 1, f: new Date(0).toISOString() },
      { id: 2, f: new Date(0) },
    ]
    const { indexed, scan } = pair(rows, [{ fields: ['f'] }])
    const got = findEq(indexed, ['f', new Date(0)])
    expect(got).toEqual(findEq(scan, ['f', new Date(0)]))
    expect(got.map(r => r.id)).toEqual([2])
  })

  it('indexed miss returns [] and matches scan; parity after delete; compound parity', () => {
    const rows: R[] = [1, 2, 3, 4].map(id => ({ id, f: 'x', a: id % 2, b: 2 }))
    const { indexed, scan } = pair(rows, [{ fields: ['f'] }, { fields: ['a', 'b'] }])
    expect(findEq(indexed, ['f', 'nope'])).toEqual([])
    expect(findEq(scan, ['f', 'nope'])).toEqual([])

    for (const a of [indexed, scan]) a.delete(2)
    expect(findEq(indexed, ['f', 'x'])).toEqual(findEq(scan, ['f', 'x']))

    for (const a of [indexed, scan]) {
      a.update(3, { a: 9 })
      a.update(3, { a: 1 })
    }
    const got = findEq(indexed, ['a', 1], ['b', 2])
    expect(got).toEqual(findEq(scan, ['a', 1], ['b', 2]))
    expect(got.map(r => r.id)).toEqual([1, 3])
  })

  it('number 1 and string "1" cells stay distinct', () => {
    const rows: R[] = [{ id: 1, f: '1' }, { id: 2, f: 1 }]
    const { indexed, scan } = pair(rows, [{ fields: ['f'] }])
    const got = findEq(indexed, ['f', 1])
    expect(got).toEqual(findEq(scan, ['f', 1]))
    expect(got.map(r => r.id)).toEqual([2])
  })
})
