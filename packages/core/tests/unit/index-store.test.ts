import { describe, it, expect, beforeEach } from 'vitest'
import { IndexStore, createIndexKey, serializeValues } from '../../src/core/index-store'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { RowWithId } from '../../src/core/types'

interface User extends RowWithId {
  id: number
  name: string
  email: string
  status: string
  role: string
  age: number
}

describe('IndexStore', () => {
  describe('utility functions', () => {
    it('should create index key from fields', () => {
      expect(createIndexKey(['status'])).toBe('status')
      expect(createIndexKey(['role', 'status'])).toBe('role|status')
      expect(createIndexKey(['a', 'b', 'c'])).toBe('a|b|c')
    })

    it('serializeValues encodes the same identity as the scan\'s = comparison', () => {
      expect(serializeValues([null])).not.toBe(serializeValues([undefined]))
      expect(serializeValues([1])).not.toBe(serializeValues(['1']))
      expect(serializeValues([new Date(1000)])).toBe(serializeValues([new Date(1000)]))
      expect(serializeValues([new Date(1000)])).toBe(serializeValues([1000]))
      expect(serializeValues([new Date(0)])).not.toBe(serializeValues([new Date(0).toISOString()]))
      expect(serializeValues(['a|b', 'c'])).not.toBe(serializeValues(['a', 'b|c']))
      expect(serializeValues([NaN])).not.toBe(serializeValues([null]))
      expect(serializeValues([true])).not.toBe(serializeValues(['true']))
    })
  })

  describe('lookup and candidates', () => {
    it('lookup returns an empty Set on a value miss and undefined when no index exists', () => {
      const store = new IndexStore<User>([{ fields: ['status'] }])
      store.rebuild([{ id: 1, status: 'a' } as User])
      const miss = store.lookup(['status'], ['zzz'])
      expect(miss).toBeInstanceOf(Set)
      expect(miss!.size).toBe(0)
      expect(store.lookup(['other'], ['x'])).toBeUndefined()
      expect(store.lookup(['status'], ['zzz'])).not.toBe(miss)
    })

    it('candidates returns the matching keys and the uncovered conditions', () => {
      const store = new IndexStore<User>([{ fields: ['role'] }])
      store.addToIndex(4, { role: 'x' } as User)
      store.addToIndex(3, { role: 'x' } as User)
      const eq = { field: 'role', operator: '=' as const, value: 'x' }
      const only = store.candidates([eq])!
      expect([...only.keys].sort()).toEqual([3, 4])
      expect(only.remaining).toEqual([])
      const gt = { field: 'age', operator: '>' as const, value: 1 }
      const mixed = store.candidates([eq, gt])!
      expect([...mixed.keys].sort()).toEqual([3, 4])
      expect(mixed.remaining).toEqual([gt])
      expect(store.candidates([gt])).toBeUndefined()
      expect(new IndexStore<User>([]).candidates([eq])).toBeUndefined()
    })

    it('IndexStore keyed by id: add/remove/update/lookup/candidates use the key type', () => {
      const store = new IndexStore<User, string>([{ fields: ['status'] }])
      const u1 = { status: 'active' } as User
      const u2 = { status: 'active' } as User
      const other = { status: 'other' } as User
      store.addToIndex('u1', u1)
      store.addToIndex('u2', u2)
      store.addToIndex('u3', other)
      expect(store.lookup(['status'], ['active'])).toEqual(new Set(['u1', 'u2']))

      const untouched = store.lookup(['status'], ['other'])
      store.updateIndex('u1', u1, { status: 'x' } as User)
      expect(store.lookup(['status'], ['active'])).toEqual(new Set(['u2']))
      const eq = { field: 'status', operator: '=' as const, value: 'x' }
      expect(store.candidates([eq])!.keys).toEqual(['u1'])

      store.removeFromIndex('u2', u2)
      expect(store.lookup(['status'], ['active'])!.size).toBe(0)
      expect(store.lookup(['status'], ['other'])).toBe(untouched)
    })

    it('positional default still supports rebuild and reindexAfterDelete', () => {
      const store = new IndexStore<User>([{ fields: ['status'] }])
      store.rebuild([{ status: 'a' }, { status: 'a' }, { status: 'a' }] as User[])
      expect(store.lookup(['status'], ['a'])).toEqual(new Set([0, 1, 2]))
    })
  })

  describe('single-column index', () => {
    let store: IndexStore<User>

    beforeEach(() => {
      store = new IndexStore<User>([
        { fields: ['status'] },
        { fields: ['role'] }
      ])
    })

    it('should build index from data', () => {
      const users: User[] = [
        { id: 1, name: 'John', email: 'john@test.com', status: 'active', role: 'admin', age: 30 },
        { id: 2, name: 'Jane', email: 'jane@test.com', status: 'active', role: 'user', age: 25 },
        { id: 3, name: 'Bob', email: 'bob@test.com', status: 'inactive', role: 'user', age: 35 }
      ]
      
      store.rebuild(users)
      
      // status='active' → [0, 1]
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices).toBeDefined()
      expect(activeIndices!.size).toBe(2)
      expect(activeIndices!.has(0)).toBe(true)
      expect(activeIndices!.has(1)).toBe(true)
      
      // role='user' → [1, 2]
      const userIndices = store.lookup(['role'], ['user'])
      expect(userIndices).toBeDefined()
      expect(userIndices!.size).toBe(2)
      expect(userIndices!.has(1)).toBe(true)
      expect(userIndices!.has(2)).toBe(true)
    })

    it('should return undefined for non-indexed fields', () => {
      const result = store.lookup(['email'], ['test@test.com'])
      expect(result).toBeUndefined()
    })

    it('should return empty set for non-existent values', () => {
      const users: User[] = [
        { id: 1, name: 'John', email: 'john@test.com', status: 'active', role: 'admin', age: 30 }
      ]
      store.rebuild(users)
      
      const result = store.lookup(['status'], ['pending'])
      expect(result).toEqual(new Set()) // Indexed miss is an empty set
    })

    it('should track index existence', () => {
      expect(store.hasIndex(['status'])).toBe(true)
      expect(store.hasIndex(['role'])).toBe(true)
      expect(store.hasIndex(['email'])).toBe(false)
      expect(store.hasIndex(['status', 'role'])).toBe(false) // compound not defined
    })
  })

  describe('compound index', () => {
    let store: IndexStore<User>

    beforeEach(() => {
      store = new IndexStore<User>([
        { fields: ['role', 'status'] }
      ])
    })

    it('should build and lookup compound index', () => {
      const users: User[] = [
        { id: 1, name: 'John', email: 'john@test.com', status: 'active', role: 'admin', age: 30 },
        { id: 2, name: 'Jane', email: 'jane@test.com', status: 'active', role: 'user', age: 25 },
        { id: 3, name: 'Bob', email: 'bob@test.com', status: 'inactive', role: 'user', age: 35 },
        { id: 4, name: 'Alice', email: 'alice@test.com', status: 'active', role: 'user', age: 28 }
      ]
      
      store.rebuild(users)
      
      // (role='user', status='active') → [1, 3]
      const indices = store.lookup(['role', 'status'], ['user', 'active'])
      expect(indices).toBeDefined()
      expect(indices!.size).toBe(2)
      expect(indices!.has(1)).toBe(true)
      expect(indices!.has(3)).toBe(true)
    })

    it('should respect field order', () => {
      // Reversed order should not match
      expect(store.hasIndex(['status', 'role'])).toBe(false)
      expect(store.hasIndex(['role', 'status'])).toBe(true)
    })
  })

  describe('index updates', () => {
    let store: IndexStore<User>
    const users: User[] = [
      { id: 1, name: 'John', email: 'john@test.com', status: 'active', role: 'admin', age: 30 },
      { id: 2, name: 'Jane', email: 'jane@test.com', status: 'active', role: 'user', age: 25 }
    ]

    beforeEach(() => {
      store = new IndexStore<User>([{ fields: ['status'] }])
      store.rebuild(users)
    })

    it('should add new row to index', () => {
      const newUser: User = { id: 3, name: 'Bob', email: 'bob@test.com', status: 'active', role: 'user', age: 35 }
      store.addToIndex(2, newUser)
      
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices!.size).toBe(3)
      expect(activeIndices!.has(2)).toBe(true)
    })

    it('should update index when row changes', () => {
      const oldUser = users[0]
      const newUser: User = { ...oldUser, status: 'inactive' }
      
      store.updateIndex(0, oldUser, newUser)
      
      // active should now only have index 1
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices!.size).toBe(1)
      expect(activeIndices!.has(0)).toBe(false)
      
      // inactive should have index 0
      const inactiveIndices = store.lookup(['status'], ['inactive'])
      expect(inactiveIndices!.size).toBe(1)
      expect(inactiveIndices!.has(0)).toBe(true)
    })

    it('should not update index if value unchanged', () => {
      const oldUser = users[0]
      const newUser: User = { ...oldUser, name: 'Johnny' } // status unchanged
      
      store.updateIndex(0, oldUser, newUser)
      
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices!.size).toBe(2) // Still 2
    })

    it('should remove row from index', () => {
      store.removeFromIndex(0, users[0])
      
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices!.size).toBe(1)
      expect(activeIndices!.has(0)).toBe(false)
    })

    it('should reindex after delete (shift indices)', () => {
      // After deleting index 0, index 1 becomes index 0
      store.removeFromIndex(0, users[0])
      store.reindexAfterDelete(0)
      
      const activeIndices = store.lookup(['status'], ['active'])
      expect(activeIndices!.size).toBe(1)
      expect(activeIndices!.has(0)).toBe(true) // Former index 1 is now 0
    })
  })
})

describe('MockAdapter with indexes', () => {
  interface TestUser extends RowWithId {
    id: number
    name: string
    status: string
    role: string
    age: number
  }

  describe('single-column index', () => {
    let adapter: MockAdapter<TestUser>

    beforeEach(() => {
      adapter = new MockAdapter<TestUser>({
        indexes: [
          { fields: ['status'] },
          { fields: ['role'] }
        ]
      })
      
      adapter.insert({ name: 'John', status: 'active', role: 'admin', age: 30 })
      adapter.insert({ name: 'Jane', status: 'active', role: 'user', age: 25 })
      adapter.insert({ name: 'Bob', status: 'inactive', role: 'user', age: 35 })
    })

    it('should use index for equality query', () => {
      const result = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      
      expect(result.length).toBe(2)
      expect(result.every(u => u.status === 'active')).toBe(true)
    })

    it('should use index for multiple equality conditions', () => {
      const result = adapter.find({
        where: [
          { field: 'status', operator: '=', value: 'active' },
          { field: 'role', operator: '=', value: 'user' }
        ],
        orderBy: []
      })
      
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Jane')
    })

    it('should fall back to full scan for non-indexed fields', () => {
      const result = adapter.find({
        where: [{ field: 'age', operator: '=', value: 30 }],
        orderBy: []
      })
      
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('John')
    })

    it('should combine index with non-equality conditions', () => {
      const result = adapter.find({
        where: [
          { field: 'status', operator: '=', value: 'active' },
          { field: 'age', operator: '>', value: 26 }
        ],
        orderBy: []
      })
      
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('John')
    })
  })

  describe('compound index', () => {
    let adapter: MockAdapter<TestUser>

    beforeEach(() => {
      adapter = new MockAdapter<TestUser>({
        indexes: [
          { fields: ['role', 'status'] }
        ]
      })
      
      adapter.insert({ name: 'John', status: 'active', role: 'admin', age: 30 })
      adapter.insert({ name: 'Jane', status: 'active', role: 'user', age: 25 })
      adapter.insert({ name: 'Bob', status: 'inactive', role: 'user', age: 35 })
      adapter.insert({ name: 'Alice', status: 'active', role: 'user', age: 28 })
    })

    it('should use compound index', () => {
      const result = adapter.find({
        where: [
          { field: 'role', operator: '=', value: 'user' },
          { field: 'status', operator: '=', value: 'active' }
        ],
        orderBy: []
      })
      
      expect(result.length).toBe(2)
      expect(result.every(u => u.role === 'user' && u.status === 'active')).toBe(true)
    })
  })

  describe('index maintenance on CRUD', () => {
    let adapter: MockAdapter<TestUser>

    beforeEach(() => {
      adapter = new MockAdapter<TestUser>({
        indexes: [{ fields: ['status'] }]
      })
      
      adapter.insert({ name: 'John', status: 'active', role: 'admin', age: 30 })
      adapter.insert({ name: 'Jane', status: 'active', role: 'user', age: 25 })
    })

    it('should update index on insert', () => {
      adapter.insert({ name: 'Bob', status: 'active', role: 'user', age: 35 })
      
      const result = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      
      expect(result.length).toBe(3)
    })

    it('should update index on update', () => {
      // Change John's status to inactive
      adapter.update(1, { status: 'inactive' })
      
      const activeResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      expect(activeResult.length).toBe(1)
      expect(activeResult[0].name).toBe('Jane')
      
      const inactiveResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'inactive' }],
        orderBy: []
      })
      expect(inactiveResult.length).toBe(1)
      expect(inactiveResult[0].name).toBe('John')
    })

    it('should update index on delete', () => {
      adapter.delete(1) // Delete John
      
      const result = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Jane')
    })

    it('should update index on batch insert', () => {
      adapter.batchInsert([
        { name: 'Bob', status: 'active', role: 'user', age: 35 },
        { name: 'Alice', status: 'inactive', role: 'user', age: 28 }
      ])
      
      const activeResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      expect(activeResult.length).toBe(3)
      
      const inactiveResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'inactive' }],
        orderBy: []
      })
      expect(inactiveResult.length).toBe(1)
    })

    it('should update index on batch update', () => {
      adapter.batchUpdate([
        { id: 1, data: { status: 'inactive' } },
        { id: 2, data: { status: 'pending' } }
      ])
      
      const activeResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
      expect(activeResult.length).toBe(0)
      
      const inactiveResult = adapter.find({
        where: [{ field: 'status', operator: '=', value: 'inactive' }],
        orderBy: []
      })
      expect(inactiveResult.length).toBe(1)
    })
  })

  describe('backward compatibility', () => {
    it('should work with array constructor (no indexes)', () => {
      const adapter = new MockAdapter<TestUser>([
        { id: 1, name: 'John', status: 'active', role: 'admin', age: 30 }
      ])
      
      expect(adapter.findAll().length).toBe(1)
      expect(adapter.findById(1)?.name).toBe('John')
    })

    it('should work with no constructor args', () => {
      const adapter = new MockAdapter<TestUser>()
      adapter.insert({ name: 'John', status: 'active', role: 'admin', age: 30 })
      
      expect(adapter.findAll().length).toBe(1)
    })
  })
})

describe('Index lookup cost', () => {
  interface BenchRow extends RowWithId {
    id: number
    status: string
  }

  /** Rows whose `status` getter counts every read. */
  function countingRows(size: number, counter: { reads: number }): BenchRow[] {
    const statuses = ['active', 'inactive', 'pending', 'deleted']
    return Array.from({ length: size }, (_, i) => {
      const row = { id: i } as BenchRow
      const status = statuses[i % statuses.length]
      Object.defineProperty(row, 'status', {
        get() {
          counter.reads++
          return status
        },
        enumerable: true,
      })
      return row
    })
  }

  it('indexed find evaluates no stored row, while a scan evaluates every row', () => {
    const SIZE = 10000
    const LOOKUPS = 100
    const indexedCounter = { reads: 0 }
    const scanCounter = { reads: 0 }
    const indexed = new MockAdapter<BenchRow>({
      initialData: countingRows(SIZE, indexedCounter),
      indexes: [{ fields: ['status'] }],
    })
    const scan = new MockAdapter<BenchRow>({ initialData: countingRows(SIZE, scanCounter) })
    indexedCounter.reads = 0
    scanCounter.reads = 0

    const query = {
      where: [{ field: 'status', operator: '=' as const, value: 'active' }],
      orderBy: [],
    }
    for (let i = 0; i < LOOKUPS; i++) {
      const fromIndex = indexed.find(query)
      const fromScan = scan.find(query)
      expect(fromIndex).toHaveLength(SIZE / 4)
      expect(fromScan).toHaveLength(SIZE / 4)
      // Compare ids only: comparing rows would read `status` and skew the counters
      expect(fromIndex.map(r => r.id)).toEqual(fromScan.map(r => r.id))
    }

    expect(indexedCounter.reads).toBe(0)
    expect(scanCounter.reads).toBe(LOOKUPS * SIZE)
  })
})
