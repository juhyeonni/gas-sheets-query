import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter, Repository, defineSheetsDB } from '../../src'
import type { RowWithId } from '../../src/core/types'

interface User extends RowWithId {
  id: number
  name: string
  email: string
  age: number
}

describe('Batch Operations', () => {
  describe('MockAdapter batch methods', () => {
    let adapter: MockAdapter<User>

    beforeEach(() => {
      adapter = new MockAdapter<User>()
    })

    describe('batchInsert', () => {
      it('should insert multiple rows at once', () => {
        const users = [
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 },
          { name: 'Bob', email: 'bob@test.com', age: 35 }
        ]

        const result = adapter.batchInsert(users)

        expect(result.length).toBe(3)
        expect(result[0].id).toBe(1)
        expect(result[1].id).toBe(2)
        expect(result[2].id).toBe(3)
        expect(result[0].name).toBe('John')
        expect(result[1].name).toBe('Jane')
        expect(result[2].name).toBe('Bob')
      })

      it('should update ID index correctly', () => {
        adapter.batchInsert([
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 }
        ])

        expect(adapter.findById(1)?.name).toBe('John')
        expect(adapter.findById(2)?.name).toBe('Jane')
      })

      it('should return empty array for empty input', () => {
        const result = adapter.batchInsert([])
        expect(result).toEqual([])
      })

      it('should increment IDs correctly after batch insert', () => {
        adapter.batchInsert([
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 }
        ])

        const single = adapter.insert({ name: 'Bob', email: 'bob@test.com', age: 35 })
        expect(single.id).toBe(3)
      })
    })

    describe('batchUpdate', () => {
      beforeEach(() => {
        adapter.batchInsert([
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 },
          { name: 'Bob', email: 'bob@test.com', age: 35 }
        ])
      })

      it('should update multiple rows at once', () => {
        const result = adapter.batchUpdate([
          { id: 1, data: { name: 'John Updated' } },
          { id: 2, data: { name: 'Jane Updated', age: 26 } }
        ])

        expect(result.length).toBe(2)
        expect(result[0].name).toBe('John Updated')
        expect(result[1].name).toBe('Jane Updated')
        expect(result[1].age).toBe(26)
      })

      it('should skip non-existent rows', () => {
        const result = adapter.batchUpdate([
          { id: 1, data: { name: 'John Updated' } },
          { id: 999, data: { name: 'Does not exist' } },
          { id: 3, data: { name: 'Bob Updated' } }
        ])

        expect(result.length).toBe(2)
        expect(result[0].name).toBe('John Updated')
        expect(result[1].name).toBe('Bob Updated')
      })

      it('should return empty array if no rows found', () => {
        const result = adapter.batchUpdate([
          { id: 100, data: { name: 'Not found' } },
          { id: 200, data: { name: 'Also not found' } }
        ])

        expect(result).toEqual([])
      })

      it('should persist updates correctly', () => {
        adapter.batchUpdate([
          { id: 1, data: { name: 'John Updated' } },
          { id: 2, data: { age: 26 } }
        ])

        expect(adapter.findById(1)?.name).toBe('John Updated')
        expect(adapter.findById(2)?.age).toBe(26)
        expect(adapter.findById(3)?.name).toBe('Bob') // unchanged
      })
    })
  })

  describe('Repository batch methods', () => {
    let adapter: MockAdapter<User>
    let repo: Repository<User>

    beforeEach(() => {
      adapter = new MockAdapter<User>()
      repo = new Repository<User>(adapter, 'users')
    })

    describe('batchInsert', () => {
      it('should delegate to store.batchInsert', () => {
        const users = [
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 }
        ]

        const result = repo.batchInsert(users)

        expect(result.length).toBe(2)
        expect(repo.count()).toBe(2)
      })
    })

    describe('batchUpdate', () => {
      beforeEach(() => {
        repo.batchInsert([
          { name: 'John', email: 'john@test.com', age: 30 },
          { name: 'Jane', email: 'jane@test.com', age: 25 }
        ])
      })

      it('should delegate to store.batchUpdate', () => {
        const result = repo.batchUpdate([
          { id: 1, data: { name: 'John Updated' } },
          { id: 2, data: { name: 'Jane Updated' } }
        ])

        expect(result.length).toBe(2)
        expect(repo.findById(1).name).toBe('John Updated')
        expect(repo.findById(2).name).toBe('Jane Updated')
      })
    })
  })

  describe('SheetsDB batch methods', () => {
    it('should expose batchInsert and batchUpdate through TableHandle', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'email', 'age'] as const,
            types: { id: 0, name: '', email: '', age: 0 }
          }
        },
        stores: {
          users: new MockAdapter()
        }
      })

      // Test batchInsert
      const inserted = db.from('users').batchInsert([
        { name: 'John', email: 'john@test.com', age: 30 },
        { name: 'Jane', email: 'jane@test.com', age: 25 }
      ])

      expect(inserted.length).toBe(2)
      expect(inserted[0].name).toBe('John')
      expect(inserted[1].name).toBe('Jane')

      // Test batchUpdate
      const updated = db.from('users').batchUpdate([
        { id: 1, data: { name: 'John Updated' } },
        { id: 2, data: { name: 'Jane Updated' } }
      ])

      expect(updated.length).toBe(2)
      expect(db.from('users').findById(1).name).toBe('John Updated')
      expect(db.from('users').findById(2).name).toBe('Jane Updated')
    })
  })
})
