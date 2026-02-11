import { describe, it, expect, beforeEach } from 'vitest'
import { Repository } from '../../src/core/repository'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { QueryBuilder } from '../../src/core/query-builder'
import type { RowWithId } from '../../src/core/types'

interface TestRow extends RowWithId {
  id: number
  name: string
  value: string
}

describe('Edge Cases', () => {
  let adapter: MockAdapter<TestRow>
  let repo: Repository<TestRow>

  beforeEach(() => {
    adapter = new MockAdapter<TestRow>()
    repo = new Repository(adapter)
  })

  describe('Empty data handling', () => {
    it('should handle findAll on empty repository', () => {
      const results = repo.findAll()
      expect(results).toEqual([])
      expect(results.length).toBe(0)
    })

    it('should handle query on empty repository', () => {
      const query = new QueryBuilder(adapter)
      const results = query.where('name', '=', 'test').exec()
      expect(results).toEqual([])
    })

    it('should handle first() on empty results', () => {
      const query = new QueryBuilder(adapter)
      const result = query.where('name', '=', 'test').first()
      expect(result).toBeUndefined()
    })

    it('should handle count on empty repository', () => {
      expect(repo.count()).toBe(0)
    })

    it('should throw when updating non-existent row', () => {
      expect(() => repo.update(999, { name: 'test', value: 'test' })).toThrow()
    })

    it('should throw when deleting non-existent row', () => {
      expect(() => repo.delete(999)).toThrow()
    })

    it('should handle exists() on empty repository', () => {
      const query = new QueryBuilder(adapter)
      const exists = query.where('name', '=', 'test').exists()
      expect(exists).toBe(false)
    })
  })

  describe('Special characters', () => {
    it('should handle unicode characters', () => {
      const row = repo.create({ name: '한글테스트', value: '日本語' })
      expect(row.name).toBe('한글테스트')
      expect(row.value).toBe('日本語')

      const found = repo.findById(row.id)
      expect(found.name).toBe('한글테스트')
    })

    it('should handle emojis', () => {
      const row = repo.create({ name: 'Test 🚀', value: '✨💡🎉' })
      expect(row.name).toBe('Test 🚀')
      expect(row.value).toBe('✨💡🎉')
    })

    it('should handle quotes in values', () => {
      const row = repo.create({ name: "It's a test", value: 'He said "hello"' })
      expect(row.name).toBe("It's a test")
      expect(row.value).toBe('He said "hello"')
    })

    it('should handle newlines', () => {
      const row = repo.create({ name: 'Line 1\nLine 2', value: 'Value\nWith\nNewlines' })
      expect(row.name).toBe('Line 1\nLine 2')
      expect(row.value).toBe('Value\nWith\nNewlines')
    })

    it('should handle special SQL-like characters', () => {
      const row = repo.create({ name: "'; DROP TABLE--", value: '%_*?' })
      expect(row.name).toBe("'; DROP TABLE--")
      expect(row.value).toBe('%_*?')
    })

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000)
      const row = repo.create({ name: longString, value: 'test' })
      expect(row.name).toBe(longString)
      expect(row.name.length).toBe(10000)
    })

    it('should handle empty strings', () => {
      const row = repo.create({ name: '', value: '' })
      expect(row.name).toBe('')
      expect(row.value).toBe('')
    })
  })

  describe('Query edge cases', () => {
    beforeEach(() => {
      repo.create({ name: 'Alice', value: '100' })
      repo.create({ name: 'Bob', value: '200' })
      repo.create({ name: 'Charlie', value: '300' })
    })

    it('should handle multiple where clauses', () => {
      const query = new QueryBuilder(adapter)
      const results = query
        .where('name', '=', 'Alice')
        .where('value', '=', '100')
        .exec()

      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Alice')
    })

    it('should handle empty where value', () => {
      repo.create({ name: '', value: 'empty' })
      const query = new QueryBuilder(adapter)
      const results = query.where('name', '=', '').exec()
      expect(results.length).toBe(1)
      expect(results[0].value).toBe('empty')
    })

    it('should handle case-sensitive matching', () => {
      const query = new QueryBuilder(adapter)
      const results = query.where('name', '=', 'alice').exec()
      expect(results.length).toBe(0) // Should not match 'Alice'
    })

    it('should handle limit(0)', () => {
      const query = new QueryBuilder(adapter)
      const results = query.limit(0).exec()
      expect(results).toEqual([])
    })

    it('should handle offset larger than dataset', () => {
      const query = new QueryBuilder(adapter)
      const results = query.offset(1000).exec()
      expect(results).toEqual([])
    })

    it('should handle orderBy with identical values', () => {
      repo.create({ name: 'Same', value: 'A' })
      repo.create({ name: 'Same', value: 'B' })
      repo.create({ name: 'Same', value: 'C' })

      const query = new QueryBuilder(adapter)
      const results = query.where('name', '=', 'Same').orderBy('name', 'asc').exec()
      expect(results.length).toBe(3)
    })
  })

  describe('Boundary conditions', () => {
    it('should handle id = 0', () => {
      const adapter = new MockAdapter<TestRow>({ idMode: 'client' })
      const repo = new Repository(adapter)

      const row = repo.create({ id: 0, name: 'Zero', value: 'test' })
      expect(row.id).toBe(0)

      const found = repo.findById(0)
      expect(found.name).toBe('Zero')
    })

    it('should handle negative ids', () => {
      const adapter = new MockAdapter<TestRow>({ idMode: 'client' })
      const repo = new Repository(adapter)

      const row = repo.create({ id: -1, name: 'Negative', value: 'test' })
      expect(row.id).toBe(-1)
    })

    it('should handle very large id numbers', () => {
      const adapter = new MockAdapter<TestRow>({ idMode: 'client' })
      const repo = new Repository(adapter)

      const largeId = Number.MAX_SAFE_INTEGER
      const row = repo.create({ id: largeId, name: 'Large', value: 'test' })
      expect(row.id).toBe(largeId)
    })

    it('should handle batch operations on empty set', () => {
      const results = repo.batchInsert([])
      expect(results).toEqual([])
    })

    it('should handle single item in batch', () => {
      const results = repo.batchInsert([{ name: 'Single', value: 'test' }])
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Single')
    })
  })

  describe('Type coercion', () => {
    it('should preserve number-like strings', () => {
      const row = repo.create({ name: '123', value: '456.78' })
      expect(row.name).toBe('123')
      expect(typeof row.name).toBe('string')
    })

    it('should preserve boolean-like strings', () => {
      const row = repo.create({ name: 'true', value: 'false' })
      expect(row.name).toBe('true')
      expect(typeof row.name).toBe('string')
    })

    it('should handle null-like strings', () => {
      const row = repo.create({ name: 'null', value: 'undefined' })
      expect(row.name).toBe('null')
      expect(row.value).toBe('undefined')
    })
  })

  describe('Concurrent operations', () => {
    it('should handle rapid sequential creates', () => {
      const results = []
      for (let i = 0; i < 100; i++) {
        results.push(repo.create({ name: `User${i}`, value: `value${i}` }))
      }

      expect(results.length).toBe(100)
      expect(results[0].id).toBe(1)
      expect(results[99].id).toBe(100)
    })

    it('should handle interleaved create/update/delete', () => {
      const row1 = repo.create({ name: 'User1', value: 'v1' })
      const row2 = repo.create({ name: 'User2', value: 'v2' })

      repo.update(row1.id, { name: 'Updated1', value: 'v1' })
      repo.delete(row2.id)

      const row3 = repo.create({ name: 'User3', value: 'v3' })

      expect(repo.findAll().length).toBe(2)
      expect(repo.findById(row1.id).name).toBe('Updated1')
      expect(() => repo.findById(row2.id)).toThrow()
      expect(row3.name).toBe('User3')
    })
  })

  describe('Error recovery', () => {
    it('should maintain data integrity after failed update', () => {
      const row = repo.create({ name: 'Original', value: 'v1' })

      try {
        repo.update(999, { name: 'Should fail', value: 'v2' })
      } catch {
        // Expected error
      }

      const found = repo.findById(row.id)
      expect(found.name).toBe('Original')
    })

    it('should maintain data integrity after failed delete', () => {
      const row = repo.create({ name: 'Permanent', value: 'v1' })

      try {
        repo.delete(999)
      } catch {
        // Expected error
      }

      const found = repo.findById(row.id)
      expect(found.name).toBe('Permanent')
    })
  })
})
