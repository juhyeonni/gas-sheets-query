/**
 * Additional error handling tests to improve coverage
 */
import { describe, it, expect } from 'vitest'
import { Repository } from '../../src/core/repository'
import {
  TableNotFoundError,
  MissingStoreError,
  defineSheetsDB,
  MockAdapter
} from '../../src'
import type { DataStore, RowWithId } from '../../src/core/types'

interface TestRow extends RowWithId {
  id: number
  name: string
  value: string
}

describe('Error Handling Edge Cases', () => {
  describe('Repository batch fallbacks', () => {
    it('should use fallback when store does not implement batchInsert', () => {
      // Create a minimal store without batchInsert
      let counter = 1
      const store: DataStore<TestRow> = {
        findAll: () => [],
        find: () => [],
        findById: () => undefined,
        insert: (data) => ({ id: counter++, ...data } as TestRow),
        update: () => undefined,
        delete: () => false
        // No batchInsert implementation
      }

      const repo = new Repository(store)
      const results = repo.batchInsert([
        { name: 'A', value: 'v1' },
        { name: 'B', value: 'v2' }
      ])

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe(1)
      expect(results[1].id).toBe(2)
    })

    it('should use fallback when store does not implement batchUpdate', () => {
      let counter = 1
      const data: TestRow[] = [
        { id: 1, name: 'A', value: 'v1' },
        { id: 2, name: 'B', value: 'v2' }
      ]

      // Create a minimal store without batchUpdate
      const store: DataStore<TestRow> = {
        findAll: () => data,
        find: () => data,
        findById: (id) => data.find(r => r.id === id),
        insert: (d) => ({ id: counter++, ...d } as TestRow),
        update: (id, updates) => {
          const row = data.find(r => r.id === id)
          if (!row) return undefined
          return { ...row, ...updates }
        },
        delete: () => false
        // No batchUpdate implementation
      }

      const repo = new Repository(store)
      const results = repo.batchUpdate([
        { id: 1, data: { name: 'Updated A' } },
        { id: 2, data: { name: 'Updated B' } },
        { id: 999, data: { name: 'Not found' } } // Should skip
      ])

      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('Updated A')
      expect(results[1].name).toBe('Updated B')
    })
  })

  describe('SheetsDB error handling', () => {
    it('should throw TableNotFoundError when accessing non-existent table', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: {
          users: new MockAdapter<{ id: number; name: string }>()
        }
      })

      expect(() => {
        db.from('nonexistent' as 'users')
      }).toThrow(TableNotFoundError)
    })

    it('should throw TableNotFoundError in getStore', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: {
          users: new MockAdapter<{ id: number; name: string }>()
        }
      })

      expect(() => {
        db.getStore('nonexistent' as 'users')
      }).toThrow(TableNotFoundError)
    })

    it('should throw MissingStoreError when store not provided', () => {
      expect(() => {
        defineSheetsDB({
          tables: {
            users: {
              columns: ['id', 'name'] as const,
              types: { id: 0, name: '' }
            }
          },
          stores: {} as any // Force empty stores to test error
        })
      }).toThrow(MissingStoreError)
    })
  })

  describe('Repository error scenarios', () => {
    it('should throw when finding by non-existent id', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter, 'test_table')

      expect(() => repo.findById(999)).toThrow()
    })

    it('should throw when updating non-existent row', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter, 'test_table')

      expect(() => repo.update(999, { name: 'test' })).toThrow()
    })

    it('should throw when deleting non-existent row', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter, 'test_table')

      expect(() => repo.delete(999)).toThrow()
    })

    it('should not throw when using "OrNull" variants', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      expect(repo.findByIdOrNull(999)).toBeUndefined()
      expect(repo.updateOrNull(999, { name: 'test' })).toBeUndefined()
      expect(repo.deleteIfExists(999)).toBe(false)
    })
  })

  describe('Data integrity', () => {
    it('should maintain data integrity after failed operations', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const row = repo.create({ name: 'Original', value: 'v1' })
      const originalCount = repo.count()

      // Try invalid operations
      try {
        repo.update(999, { name: 'Should fail' })
      } catch {
        // Expected
      }

      try {
        repo.delete(999)
      } catch {
        // Expected
      }

      // Verify data unchanged
      expect(repo.count()).toBe(originalCount)
      expect(repo.findById(row.id).name).toBe('Original')
    })

    it('should handle empty batch operations gracefully', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      expect(repo.batchInsert([])).toEqual([])
      expect(repo.batchUpdate([])).toEqual([])
    })
  })
})
