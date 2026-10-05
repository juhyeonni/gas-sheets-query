/**
 * MockAdapter-specific indexed find cases (#235).
 *
 * Indexed-vs-unindexed `=` find parity for rows written through the DataStore
 * interface (#239) is a clause of the shared conformance suite
 * (`datastore-conformance.test.ts`, #195). What stays here needs seeded rows
 * that share an id, which only a store seeded verbatim can hold.
 */
import { describe, it, expect } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { IndexDefinition } from '../../src/core/index-store'
import type { RowWithId } from '../../src/core/types'

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
