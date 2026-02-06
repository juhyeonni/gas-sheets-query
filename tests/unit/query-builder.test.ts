import { describe, it, expect, beforeEach } from 'vitest'
import { QueryBuilder, createQueryBuilder } from '../../src/core/query-builder'
import { MockAdapter } from '../../src/adapters/mock-adapter'

interface User {
  id: number
  name: string
  email: string
  age: number
  active: boolean
}

describe('QueryBuilder', () => {
  let adapter: MockAdapter<User>
  let query: QueryBuilder<User>

  beforeEach(() => {
    adapter = new MockAdapter<User>()
    // Insert test data
    adapter.insert({ name: 'Alice', email: 'alice@test.com', age: 25, active: true })
    adapter.insert({ name: 'Bob', email: 'bob@test.com', age: 30, active: false })
    adapter.insert({ name: 'Charlie', email: 'charlie@test.com', age: 35, active: true })
    adapter.insert({ name: 'Diana', email: 'diana@test.com', age: 28, active: true })
    adapter.insert({ name: 'Eve', email: 'eve@test.com', age: 22, active: false })
    
    query = createQueryBuilder(adapter)
  })

  describe('where', () => {
    it('should filter by equality', () => {
      const result = query.where('name', '=', 'Alice').exec()
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Alice')
    })

    it('should chain multiple where conditions', () => {
      const result = query
        .where('active', '=', true)
        .where('age', '>', 26)
        .exec()
      
      expect(result.length).toBe(2) // Charlie (35), Diana (28)
    })
  })

  describe('whereEq', () => {
    it('should be shorthand for equality', () => {
      const result = query.whereEq('name', 'Bob').exec()
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Bob')
    })
  })

  describe('whereNot', () => {
    it('should filter by inequality', () => {
      const result = query.whereNot('active', false).exec()
      expect(result.length).toBe(3) // Alice, Charlie, Diana
    })
  })

  describe('whereIn', () => {
    it('should filter by array of values', () => {
      const result = query.whereIn('name', ['Alice', 'Bob', 'Unknown']).exec()
      expect(result.length).toBe(2)
    })
  })

  describe('whereLike', () => {
    it('should filter by pattern', () => {
      const result = query.whereLike('email', '%@test.com').exec()
      expect(result.length).toBe(5)
    })

    it('should filter by prefix pattern', () => {
      const result = query.whereLike('name', 'A%').exec()
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Alice')
    })
  })

  describe('orderBy', () => {
    it('should sort ascending by default', () => {
      const result = query.orderBy('age').exec()
      expect(result[0].age).toBe(22) // Eve
      expect(result[4].age).toBe(35) // Charlie
    })

    it('should sort descending', () => {
      const result = query.orderBy('age', 'desc').exec()
      expect(result[0].age).toBe(35) // Charlie
      expect(result[4].age).toBe(22) // Eve
    })

    it('should chain multiple orderBy', () => {
      // Add another user with same age as Alice
      adapter.insert({ name: 'Zack', email: 'zack@test.com', age: 25, active: true })
      
      const result = createQueryBuilder(adapter)
        .orderBy('age', 'asc')
        .orderBy('name', 'asc')
        .exec()
      
      // Age 22: Eve, Age 25: Alice then Zack (sorted by name)
      expect(result[0].name).toBe('Eve')
      expect(result[1].name).toBe('Alice')
      expect(result[2].name).toBe('Zack')
    })
  })

  describe('limit', () => {
    it('should limit results', () => {
      const result = query.limit(2).exec()
      expect(result.length).toBe(2)
    })
  })

  describe('offset', () => {
    it('should skip results', () => {
      const result = query.orderBy('id').offset(2).exec()
      expect(result.length).toBe(3)
      expect(result[0].id).toBe(3) // Charlie
    })
  })

  describe('page', () => {
    it('should paginate correctly', () => {
      const page1 = query.orderBy('id').page(1, 2).exec()
      const page2 = query.clone().orderBy('id').page(2, 2).exec()
      const page3 = query.clone().orderBy('id').page(3, 2).exec()
      
      expect(page1.length).toBe(2)
      expect(page1[0].id).toBe(1) // Alice
      
      expect(page2.length).toBe(2)
      expect(page2[0].id).toBe(3) // Charlie
      
      expect(page3.length).toBe(1)
      expect(page3[0].id).toBe(5) // Eve
    })
  })

  describe('first', () => {
    it('should return first result', () => {
      const result = query.orderBy('age').first()
      expect(result?.name).toBe('Eve') // youngest
    })

    it('should return undefined when no results', () => {
      const result = query.where('name', '=', 'NonExistent').first()
      expect(result).toBeUndefined()
    })
  })

  describe('firstOrFail', () => {
    it('should return first result', () => {
      const result = query.orderBy('age').firstOrFail()
      expect(result.name).toBe('Eve')
    })

    it('should throw when no results', () => {
      expect(() => 
        query.where('name', '=', 'NonExistent').firstOrFail()
      ).toThrow('No results found')
    })
  })

  describe('count', () => {
    it('should count all results', () => {
      expect(query.count()).toBe(5)
    })

    it('should count filtered results', () => {
      const count = query.where('active', '=', true).count()
      expect(count).toBe(3)
    })

    it('should ignore limit/offset for counting', () => {
      const count = query.limit(2).offset(1).count()
      expect(count).toBe(5) // counts all, ignores pagination
    })
  })

  describe('exists', () => {
    it('should return true when results exist', () => {
      expect(query.where('name', '=', 'Alice').exists()).toBe(true)
    })

    it('should return false when no results', () => {
      expect(query.where('name', '=', 'NonExistent').exists()).toBe(false)
    })
  })

  describe('clone', () => {
    it('should create independent copy', () => {
      const original = query.where('active', '=', true)
      const cloned = original.clone().where('age', '>', 26)
      
      expect(original.count()).toBe(3)
      expect(cloned.count()).toBe(2)
    })
  })

  describe('build', () => {
    it('should return query options object', () => {
      const options = query
        .where('active', '=', true)
        .orderBy('name')
        .limit(10)
        .offset(5)
        .build()
      
      expect(options.where.length).toBe(1)
      expect(options.orderBy.length).toBe(1)
      expect(options.limitValue).toBe(10)
      expect(options.offsetValue).toBe(5)
    })
  })

  describe('complex queries', () => {
    it('should handle combined filters and pagination', () => {
      const result = query
        .where('active', '=', true)
        .where('age', '>=', 25)
        .orderBy('age', 'desc')
        .limit(2)
        .exec()
      
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('Charlie') // 35, active
      expect(result[1].name).toBe('Diana')   // 28, active
    })
  })
})
