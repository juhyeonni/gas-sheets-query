/**
 * #233 - query evaluation hot paths.
 *
 * Deterministic: Date conversions are counted with a Date subclass and
 * DataStore calls are observed with a spy store. No wall-clock assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MockAdapter,
  QueryBuilder,
  JoinQueryBuilder,
  SheetsAdapter,
  applyQuery,
  compareRows,
  compileCondition,
  evaluateCondition,
  sortRows
} from '../../src'
import type { DataStore, QueryOptions, RowWithId } from '../../src'
import { FakeSpreadsheet, installGasFakes } from '../../src/testing'

const T0 = Date.parse('2026-01-15T10:00:00.000Z')

let conversions = 0
class CountingDate extends Date {
  override getTime(): number {
    conversions++
    return super.getTime()
  }
  override valueOf(): number {
    conversions++
    return super.valueOf()
  }
}

beforeEach(() => {
  conversions = 0
})

interface Item extends RowWithId {
  id: number
  when: Date
}

function spyStore<T extends RowWithId>(inner: DataStore<T>, log: QueryOptions<T>[]): DataStore<T> {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'find') {
        return (options: QueryOptions<T>) => {
          log.push({ ...options, orderBy: [...options.orderBy] })
          return target.find(options)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

describe('in', () => {
  it('converts each candidate key once per find, not once per row (#233 item 1)', () => {
    const N = 2000
    const K = 200
    const rows: Item[] = Array.from({ length: N }, (_, i) => ({ id: i + 1, when: new CountingDate(T0 + i) }))
    const adapter = new MockAdapter<Item>(rows)
    const keys = Array.from({ length: K }, (_, i) => new CountingDate(T0 + i * 10))
    conversions = 0
    const result = new QueryBuilder(adapter).where('when', 'in', keys as never).exec()
    expect(result).toHaveLength(K)
    expect(conversions).toBeLessThanOrEqual(N + K)
  })

  it('semantics unchanged (NaN, -0, mixed types, Dates, non-array)', () => {
    const match = (field: unknown, value: unknown): boolean =>
      evaluateCondition({ id: 1, f: field }, { field: 'f', operator: 'in', value } as never)
    expect(match(NaN, [NaN])).toBe(true)
    expect(match(-0, [0])).toBe(true)
    expect(match('1', [1])).toBe(false)
    expect(match(new Date(T0), [new Date(T0)])).toBe(true)
    expect(match(5, 5)).toBe(false)
    expect(match(5, [])).toBe(false)

    const adapter = new MockAdapter<{ id: number; f: unknown }>([
      { id: 1, f: NaN },
      { id: 2, f: '1' },
      { id: 3, f: new Date(T0) }
    ])
    const find = (value: unknown) =>
      adapter.find({ where: [{ field: 'f', operator: 'in', value } as never], orderBy: [] }).map(r => r.id)
    expect(find([NaN])).toEqual([1])
    expect(find([1])).toEqual([])
    expect(find([new Date(T0)])).toEqual([3])
    expect(find(5)).toEqual([])
    expect(find([])).toEqual([])
  })
})

describe('like', () => {
  const like = (value: unknown) => ({ field: 'name', operator: 'like', value }) as never

  it('compiled predicate keeps escaping, wildcard and case semantics', () => {
    const p = compileCondition(like('a.b%'))
    expect(p({ name: 'A.Bxyz' })).toBe(true)
    expect(p({ name: 'aXbxyz' })).toBe(false)
    expect(p({ name: 5 })).toBe(false)
    const u = compileCondition(like('a_c'))
    expect(u({ name: 'abc' })).toBe(true)
    expect(u({ name: 'abbc' })).toBe(false)
    expect(compileCondition(like(5))({ name: 'x' })).toBe(false)
    expect(evaluateCondition({ name: 'A.Bxyz' }, like('a.b%'))).toBe(true)
    expect(evaluateCondition({ name: 'aXbxyz' }, like('a.b%'))).toBe(false)
    expect(evaluateCondition({ name: 5 }, like('a.b%'))).toBe(false)
    expect(evaluateCondition({ name: 'x' }, like(5))).toBe(false)
  })

  it('RegExp is constructed once per find, not per row (#233 item 2)', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `user${i}` }))
    const adapter = new MockAdapter<{ id: number; name: string }>(rows)
    const Real = RegExp
    let constructed = 0
    vi.stubGlobal(
      'RegExp',
      new Proxy(Real, {
        construct(target, args) {
          constructed++
          return Reflect.construct(target, args)
        }
      })
    )
    try {
      const result = adapter.find({ where: [{ field: 'name', operator: 'like', value: 'user1%' }], orderBy: [] })
      expect(result.length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(constructed).toBe(1)
  })
})

describe('sorting', () => {
  it('orderBy on a Date column converts each row once (#233 item 5)', () => {
    const N = 2000
    const rows: Item[] = Array.from({ length: N }, (_, i) => ({
      id: i + 1,
      when: new CountingDate(T0 + ((i * 7919) % N))
    }))
    const adapter = new MockAdapter<Item>(rows)
    conversions = 0
    const result = new QueryBuilder(adapter).orderBy('when').exec()
    expect(conversions).toBeLessThanOrEqual(2 * N)
    const times = result.map(r => Date.prototype.getTime.call(r.when))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('sortRows: stable ties, nulls last, desc, does not mutate input', () => {
    type R = { id: number; a: number | null | undefined; b: number }
    const rows: R[] = [
      { id: 1, a: 2, b: 2 },
      { id: 2, a: null, b: 1 },
      { id: 3, a: 1, b: 1 },
      { id: 4, a: 2, b: 1 },
      { id: 5, a: undefined, b: 3 },
      { id: 6, a: 1, b: 0 }
    ]
    const snapshot = [...rows]
    const asc = sortRows(rows, [{ field: 'a', direction: 'asc' }])
    expect(asc.map(r => r.id)).toEqual([3, 6, 1, 4, 2, 5])
    const desc = sortRows(rows, [{ field: 'a', direction: 'desc' }])
    expect(desc.map(r => r.id)).toEqual([2, 5, 1, 4, 3, 6])
    const multi = sortRows(rows, [
      { field: 'a', direction: 'asc' },
      { field: 'b', direction: 'asc' }
    ])
    expect(multi.map(r => r.id)).toEqual([6, 3, 4, 1, 2, 5])
    expect(rows).toEqual(snapshot)
    expect(rows.every((r, i) => r === snapshot[i])).toBe(true)
    for (const ob of [
      [{ field: 'a', direction: 'asc' }],
      [{ field: 'a', direction: 'desc' }],
      [
        { field: 'a', direction: 'asc' },
        { field: 'b', direction: 'desc' }
      ]
    ] as const) {
      const o = [...ob] as never
      expect(sortRows(rows, o)).toEqual([...rows].sort((x, y) => compareRows(x, y, o)))
    }
    const empty = sortRows(rows, [])
    expect(empty).toEqual(rows)
    expect(empty).not.toBe(rows)
  })
})

describe('applyQuery', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }))
  const base = { orderBy: [] as never[] }

  it('never mutates input; offset/limit semantics match today', () => {
    const snapshot = [...rows]
    expect(applyQuery(rows, [], { ...base, offsetValue: 3, limitValue: 2 }).map(r => r.id)).toEqual([3, 4])
    expect(applyQuery(rows, [], { ...base, limitValue: 0 })).toEqual([])
    expect(applyQuery(rows, [], { ...base, limitValue: -1 })).toHaveLength(10)
    expect(applyQuery(rows, [], { ...base, offsetValue: 20 })).toEqual([])
    const all = applyQuery(rows, [], base)
    expect(all).toEqual(rows)
    expect(all).not.toBe(rows)
    const sorted = applyQuery(rows, [], { orderBy: [{ field: 'id', direction: 'desc' }] })
    expect(sorted[0].id).toBe(9)
    expect(rows).toEqual(snapshot)
    expect(rows.every((r, i) => r === snapshot[i])).toBe(true)
  })

  it('first() without orderBy stops evaluating after the first match', () => {
    const data: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, when: new CountingDate(T0 + i) }))
    const adapter = new MockAdapter<Item>(data)
    conversions = 0
    const first = new QueryBuilder(adapter).where('when', '>=', new Date(0)).first()
    expect(first?.id).toBe(1)
    expect(conversions).toBe(1)

    const ordered = new QueryBuilder(adapter).where('when', '>=', new Date(0)).orderBy('id').first()
    expect(ordered?.id).toBe(1)
    const all = new QueryBuilder(adapter).where('when', '>=', new Date(0)).orderBy('id').exec()
    expect(all).toHaveLength(1000)
  })
})

describe('orderBy sent to the store', () => {
  interface Sale extends RowWithId {
    id: number
    category: string
    amount: number
  }
  const sales: Sale[] = [
    { id: 1, category: 'A', amount: 10 },
    { id: 2, category: 'B', amount: 20 },
    { id: 3, category: 'A', amount: 30 }
  ]

  it('count/sum/avg/min/max/ungrouped agg send orderBy: [] (#233 item 3)', () => {
    const log: QueryOptions<Sale>[] = []
    const store = spyStore(new MockAdapter<Sale>(sales), log)
    const q = () => new QueryBuilder(store).where('amount', '>', 0).orderBy('amount', 'desc')
    q().count()
    q().sum('amount')
    q().avg('amount')
    q().min('amount')
    q().max('amount')
    q().agg({ c: 'count' })
    expect(log).toHaveLength(6)
    for (const o of log) expect(o.orderBy).toEqual([])
    log.length = 0
    q().exec()
    expect(log[0].orderBy).toEqual([{ field: 'amount', direction: 'desc' }])
  })

  it('grouped agg keeps orderBy and returns groups in orderBy order', () => {
    const log: QueryOptions<Sale>[] = []
    const store = spyStore(new MockAdapter<Sale>(sales), log)
    const out = new QueryBuilder(store).orderBy('category', 'desc').groupBy('category').agg({ n: 'count' })
    expect(log[0].orderBy).toEqual([{ field: 'category', direction: 'desc' }])
    expect(out.map(g => (g as { category: string }).category)).toEqual(['B', 'A'])
  })

  it('JoinQueryBuilder.count sends orderBy: [] on both paths and restores orderBy', () => {
    interface Post extends RowWithId {
      id: number
      authorId: number
    }
    interface User extends RowWithId {
      id: number
    }
    const mainLog: QueryOptions<Post>[] = []
    const posts = spyStore(
      new MockAdapter<Post>([
        { id: 1, authorId: 1 },
        { id: 2, authorId: 99 },
        { id: 3, authorId: 1 }
      ]),
      mainLog
    )
    const users = new MockAdapter<User>([{ id: 1 }])
    const resolver = (<T extends RowWithId>(name: string) => {
      if (name === 'users') return users as unknown as DataStore<T>
      throw new Error(name)
    }) as ConstructorParameters<typeof JoinQueryBuilder>[2]

    const left = new JoinQueryBuilder<Post>(posts, 'posts', resolver).leftJoin('users', 'authorId').orderBy('id', 'desc')
    expect(left.count()).toBe(3)
    expect(mainLog[0].orderBy).toEqual([])

    mainLog.length = 0
    const inner = new JoinQueryBuilder<Post>(posts, 'posts', resolver).innerJoin('users', 'authorId').orderBy('id', 'desc')
    expect(inner.count()).toBe(2)
    expect(mainLog.every(o => o.orderBy.length === 0)).toBe(true)

    mainLog.length = 0
    inner.exec()
    expect(mainLog[0].orderBy).toEqual([{ field: 'id', direction: 'desc' }])
  })
})

describe('SheetsAdapter parity', () => {
  let restore: (() => void) | undefined
  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('in/like/orderBy/limit/offset match MockAdapter', () => {
    const handle = installGasFakes({ spreadsheets: { S: new FakeSpreadsheet('S') }, activeId: 'S' })
    restore = () => handle.restore()
    interface E extends RowWithId {
      id: number
      name: string
      when: Date
      [key: string]: unknown
    }
    const sheets = new SheetsAdapter<E>({
      spreadsheetId: 'S',
      sheetName: 'events',
      columns: ['id', 'name', 'when'],
      columnTypes: { when: 'date' }
    })
    const seed = Array.from({ length: 12 }, (_, i) => ({
      name: i % 3 === 0 ? `alpha${i}` : `beta${i}`,
      when: new Date(T0 + ((i * 5) % 12) * 1000)
    }))
    const mock = new MockAdapter<E>()
    for (const s of seed) {
      sheets.insert(s as Omit<E, 'id'>)
      mock.insert(s as Omit<E, 'id'>)
    }
    const queries: QueryOptions<E>[] = [
      { where: [{ field: 'when', operator: 'in', value: [new Date(T0), new Date(T0 + 5000)] } as never], orderBy: [] },
      { where: [{ field: 'name', operator: 'like', value: 'ALPHA%' }], orderBy: [] },
      { where: [], orderBy: [{ field: 'when', direction: 'asc' }] },
      { where: [], orderBy: [{ field: 'when', direction: 'desc' }], limitValue: 4, offsetValue: 2 },
      { where: [], orderBy: [], limitValue: 3, offsetValue: 1 }
    ]
    for (const q of queries) {
      expect(sheets.find(q)).toEqual(mock.find(q))
    }
  })
})
