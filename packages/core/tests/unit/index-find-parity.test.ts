import { describe, it, expect } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { IndexDefinition } from '../../src/core/index-store'
import type { RowWithId } from '../../src/core/types'

interface R extends RowWithId {
  id: number
  f?: unknown
  a?: unknown
  b?: unknown
}

function pair(rows: R[], indexes: IndexDefinition[]) {
  const copy = () => rows.map(r => ({ ...r }))
  return {
    indexed: new MockAdapter<R>({ initialData: copy(), indexes, idMode: 'client' }),
    scan: new MockAdapter<R>({ initialData: copy(), idMode: 'client' }),
  }
}

function findEq(adapter: MockAdapter<R>, ...conds: Array<[string, unknown]>) {
  return adapter.find({
    where: conds.map(([field, value]) => ({ field, operator: '=' as const, value })),
    orderBy: [],
  })
}

describe('MockAdapter: indexed find parity with scan (#239)', () => {
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


// ---- #235: id-keyed buckets ----

interface S extends RowWithId {
  id: string | number
  f?: unknown
  g?: unknown
}

function idPair(rows: S[], indexes: IndexDefinition[], idMode: 'auto' | 'client' = 'client') {
  const make = (indexes?: IndexDefinition[]) =>
    new MockAdapter<S>({ initialData: rows.map(r => ({ ...r })), indexes, idMode })
  return { indexed: make(indexes), scan: make(undefined) }
}

function findEqS(adapter: MockAdapter<S>, f: unknown, g?: unknown): S[] {
  const where = [{ field: 'f', operator: '=' as const, value: f }]
  if (g !== undefined) where.push({ field: 'g', operator: '=' as const, value: g })
  return adapter.find({ where, orderBy: [] })
}

describe('MockAdapter: id-keyed indexes (#235)', () => {
  it('indexed find equals scan after deletes at the front, middle and back with mixed ids', () => {
    const rows: S[] = Array.from({ length: 50 }, (_, i) => ({
      id: i % 2 ? i : `s${i}`,
      f: ['a', 'b', 'c'][i % 3],
      g: i % 2,
    }))
    const { indexed, scan } = idPair(rows, [{ fields: ['f'] }, { fields: ['f', 'g'] }])
    const check = () => {
      for (const v of ['a', 'b', 'c']) {
        expect(findEqS(indexed, v)).toEqual(findEqS(scan, v))
        for (const w of [0, 1]) expect(findEqS(indexed, v, w)).toEqual(findEqS(scan, v, w))
      }
    }
    check()
    const steps: Array<Array<string | number>> = [
      [rows[0].id], [rows[25].id], [rows[49].id],
      [rows[3].id, rows[10].id, rows[20].id, rows[31].id, rows[44].id],
    ]
    for (const ids of steps) {
      for (const a of [indexed, scan]) a.batchDelete(ids)
      check()
    }
  })

  it('auto-mode seeded ids 1 and "1" stay distinct in the index', () => {
    const rows: S[] = [{ id: 1, f: 'x' }, { id: '1', f: 'x' }]
    const { indexed, scan } = idPair(rows, [{ fields: ['f'] }], 'auto')
    expect(findEqS(indexed, 'x')).toEqual(findEqS(scan, 'x'))
    expect(findEqS(indexed, 'x')).toHaveLength(2)
    indexed.delete(1)
    expect(findEqS(indexed, 'x')).toEqual([{ id: '1', f: 'x' }])
  })

  it('seeded rows sharing an id are visible to indexed find only through the last one (pinned)', () => {
    const rows: S[] = [{ id: 'a', f: 'x' }, { id: 'a', f: 'y' }]
    const { indexed, scan } = idPair(rows, [{ fields: ['f'] }])
    expect(findEqS(indexed, 'y')).toEqual([rows[1]])
    expect(findEqS(indexed, 'x')).toEqual([])
    expect(findEqS(scan, 'x')).toEqual([rows[0]])
    expect(indexed.findById('a')).toEqual(rows[1])
    indexed.delete('a')
    expect(() => indexed.insert({ id: 'a', f: 'z' })).not.toThrow()
  })

  it('a shadowed duplicate stays invisible after deleting earlier rows (#235)', () => {
    const rows: S[] = [{ id: 'b', f: 'q' }, { id: 'a', f: 'x' }, { id: 'a', f: 'y' }]
    const { indexed, scan } = idPair(rows, [{ fields: ['f'] }])
    for (const a of [indexed, scan]) {
      a.delete('a')
      a.delete('b')
    }
    expect(indexed.findById('a')).toBeUndefined()
    expect(findEqS(indexed, 'x')).toEqual([])
    expect(findEqS(scan, 'x')).toEqual([{ id: 'a', f: 'x' }])
    expect(indexed.update('a', { f: 'z' })).toBeUndefined()
    expect(indexed.delete('a')).toBe(false)
    expect(() => indexed.insert({ id: 'a', f: 'n' })).not.toThrow()
    expect(findEqS(indexed, 'n')).toEqual([{ id: 'a', f: 'n' }])
    expect(indexed.findById('a')).toEqual({ id: 'a', f: 'n' })
  })

  it('deleting a row before a duplicated id keeps the visible (last) row indexed (#235)', () => {
    const rows: S[] = [
      { id: 'b', f: 'q' }, { id: 'a', f: 'x' }, { id: 'c', f: 'q' }, { id: 'a', f: 'y' },
    ]
    const { indexed } = idPair(rows, [{ fields: ['f'] }])
    const check = (q: S[]) => {
      expect(indexed.findById('a')).toEqual({ id: 'a', f: 'y' })
      expect(findEqS(indexed, 'y')).toEqual([{ id: 'a', f: 'y' }])
      expect(findEqS(indexed, 'x')).toEqual([])
      expect(findEqS(indexed, 'q')).toEqual(q)
    }
    indexed.delete('b')
    check([{ id: 'c', f: 'q' }])
    indexed.delete('c')
    check([])
  })

  it('indexed find equals the findById-visible scan rows through a delete/insert sequence with seeded duplicates (#235)', () => {
    const rows: S[] = Array.from({ length: 30 }, (_, i) => ({ id: `k${i < 12 ? i : 6 + (i % 6)}`, f: ['a', 'b', 'c'][i % 3] }))
    const { indexed } = idPair(rows, [{ fields: ['f'] }])
    const visible = (v: string) =>
      indexed.findAll().filter(r => r.f === v && indexed.findById(r.id) === r)
    const check = () => {
      for (const v of ['a', 'b', 'c']) expect(findEqS(indexed, v)).toEqual(visible(v))
    }
    check()
    const steps: Array<() => void> = [
      () => indexed.delete('k6'),
      () => indexed.delete('k0'),
      () => indexed.delete('k11'),
      () => indexed.insert({ id: 'k0', f: 'b' }),
      () => indexed.delete('k3'),
      () => indexed.delete('k7'),
      () => { for (const id of ['k1', 'k9']) indexed.delete(id) },
      () => indexed.insert({ id: 'k6', f: 'c' }),
    ]
    for (const step of steps) {
      step()
      check()
    }
  })
})
