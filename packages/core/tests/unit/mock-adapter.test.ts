import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { RowWithId } from '../../src/core/types'

interface User extends RowWithId {
  id: number
  name: string
  email: string
  age: number
  active: boolean
}

describe('MockAdapter', () => {
  let adapter: MockAdapter<User>

  beforeEach(() => {
    adapter = new MockAdapter<User>()
  })

  describe('find with where conditions', () => {
    beforeEach(() => {
      adapter.insert({ name: 'John', email: 'john@test.com', age: 30, active: true })
      adapter.insert({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      adapter.insert({ name: 'Bob', email: 'bob@test.com', age: 35, active: false })
    })

    it('should filter by equality', () => {
      const result = adapter.find({
        where: [{ field: 'name', operator: '=', value: 'John' }],
        orderBy: []
      })
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('John')
    })

    it('should filter by inequality', () => {
      const result = adapter.find({
        where: [{ field: 'active', operator: '!=', value: true }],
        orderBy: []
      })
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Bob')
    })

    it('should filter by greater than', () => {
      const result = adapter.find({
        where: [{ field: 'age', operator: '>', value: 28 }],
        orderBy: []
      })
      expect(result.length).toBe(2)
    })

    it('should filter by greater than or equal', () => {
      const result = adapter.find({
        where: [{ field: 'age', operator: '>=', value: 30 }],
        orderBy: []
      })
      expect(result.length).toBe(2)
    })

    it('should filter by less than', () => {
      const result = adapter.find({
        where: [{ field: 'age', operator: '<', value: 30 }],
        orderBy: []
      })
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Jane')
    })

    it('should filter by less than or equal', () => {
      const result = adapter.find({
        where: [{ field: 'age', operator: '<=', value: 30 }],
        orderBy: []
      })
      expect(result.length).toBe(2)
    })

    it('should filter by like pattern', () => {
      const result = adapter.find({
        where: [{ field: 'email', operator: 'like', value: '%@test.com' }],
        orderBy: []
      })
      expect(result.length).toBe(3)
    })

    it('should filter by like with wildcard', () => {
      const result = adapter.find({
        where: [{ field: 'name', operator: 'like', value: 'J%' }],
        orderBy: []
      })
      expect(result.length).toBe(2) // John, Jane
    })

    it('should filter by in operator', () => {
      const result = adapter.find({
        where: [{ field: 'name', operator: 'in', value: ['John', 'Jane'] }],
        orderBy: []
      })
      expect(result.length).toBe(2)
    })

    it('should apply multiple where conditions (AND)', () => {
      const result = adapter.find({
        where: [
          { field: 'active', operator: '=', value: true },
          { field: 'age', operator: '>', value: 26 }
        ],
        orderBy: []
      })
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('John')
    })
  })

  describe('find with orderBy', () => {
    beforeEach(() => {
      adapter.insert({ name: 'John', email: 'john@test.com', age: 30, active: true })
      adapter.insert({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      adapter.insert({ name: 'Bob', email: 'bob@test.com', age: 35, active: false })
    })

    it('should sort ascending', () => {
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'age', direction: 'asc' }]
      })
      expect(result[0].age).toBe(25)
      expect(result[2].age).toBe(35)
    })

    it('should sort descending', () => {
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'age', direction: 'desc' }]
      })
      expect(result[0].age).toBe(35)
      expect(result[2].age).toBe(25)
    })

    it('should sort by multiple fields', () => {
      adapter.insert({ name: 'Alice', email: 'alice@test.com', age: 25, active: false })
      
      const result = adapter.find({
        where: [],
        orderBy: [
          { field: 'age', direction: 'asc' },
          { field: 'name', direction: 'asc' }
        ]
      })
      
      // Age 25: Alice, Jane (sorted by name)
      expect(result[0].name).toBe('Alice')
      expect(result[1].name).toBe('Jane')
    })
  })

  describe('find with limit and offset', () => {
    beforeEach(() => {
      for (let i = 1; i <= 10; i++) {
        adapter.insert({ name: `User${i}`, email: `user${i}@test.com`, age: 20 + i, active: true })
      }
    })

    it('should apply limit', () => {
      const result = adapter.find({
        where: [],
        orderBy: [],
        limitValue: 3
      })
      expect(result.length).toBe(3)
    })

    it('should apply offset', () => {
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'id', direction: 'asc' }],
        offsetValue: 5
      })
      expect(result.length).toBe(5)
      expect(result[0].name).toBe('User6')
    })

    it('should apply limit and offset together', () => {
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'id', direction: 'asc' }],
        limitValue: 3,
        offsetValue: 2
      })
      expect(result.length).toBe(3)
      expect(result[0].name).toBe('User3')
      expect(result[2].name).toBe('User5')
    })
  })

  describe('reset', () => {
    it('should reset data', () => {
      adapter.insert({ name: 'John', email: 'john@test.com', age: 30, active: true })
      adapter.reset()
      
      expect(adapter.findAll().length).toBe(0)
    })

    it('should reset with initial data', () => {
      adapter.reset([
        { id: 100, name: 'Test', email: 'test@test.com', age: 20, active: true }
      ])
      
      expect(adapter.findAll().length).toBe(1)
      expect(adapter.findById(100)?.name).toBe('Test')
    })
  })
})
