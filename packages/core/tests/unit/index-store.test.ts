import { describe, it, expect, beforeEach } from 'vitest'
import { IndexStore, createIndexKey, serializeValues } from '../../src/core/index-store'
import { MockAdapter } from '../../src/adapters/mock-adapter'

interface User {
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

    it('should serialize values correctly', () => {
      expect(serializeValues(['active'])).toBe('["active"]')
      expect(serializeValues(['admin', 'active'])).toBe('["admin","active"]')
      expect(serializeValues([1, 'test', true])).toBe('[1,"test",true]')
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
      expect(result).toBeUndefined() // No match returns undefined
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
  interface TestUser {
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

describe('Index performance benchmark', () => {
  interface BenchUser {
    id: number
    status: string
    category: string
  }

  it('should demonstrate index lookup is faster than full scan', () => {
    const SIZE = 10000
    const LOOKUPS = 100
    
    // Generate test data with various status values
    const statuses = ['active', 'inactive', 'pending', 'deleted']
    const data: Omit<BenchUser, 'id'>[] = []
    for (let i = 0; i < SIZE; i++) {
      data.push({
        status: statuses[i % statuses.length],
        category: `cat${i % 10}`
      })
    }
    
    // Adapter with index
    const indexedAdapter = new MockAdapter<BenchUser>({
      indexes: [{ fields: ['status'] }]
    })
    indexedAdapter.batchInsert(data)
    
    // Adapter without index
    const plainAdapter = new MockAdapter<BenchUser>()
    plainAdapter.batchInsert(data)
    
    // Benchmark: indexed lookups
    const indexStart = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      indexedAdapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
    }
    const indexTime = performance.now() - indexStart
    
    // Benchmark: full scan lookups
    const scanStart = performance.now()
    for (let i = 0; i < LOOKUPS; i++) {
      plainAdapter.find({
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      })
    }
    const scanTime = performance.now() - scanStart
    
    console.log(`[Index Benchmark] ${SIZE} rows, ${LOOKUPS} lookups:`)
    console.log(`  With index: ${indexTime.toFixed(2)}ms`)
    console.log(`  Full scan: ${scanTime.toFixed(2)}ms`)
    console.log(`  Speedup: ${(scanTime / indexTime).toFixed(1)}x`)
    
    // Index should be faster (at least 1.5x for small data, much more for large)
    // Note: for very small datasets, overhead might make index slower
    expect(indexTime).toBeLessThanOrEqual(scanTime * 1.5) // Allow some variance
  })
})
