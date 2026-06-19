/**
 * Large dataset behavior tests for stability validation.
 *
 * These verify the system stays CORRECT at scale (10k+ rows). Timing is logged
 * for information only — assertions are behavioral, never wall-clock, because
 * wall-clock thresholds flake on shared CI runners (see #86).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Repository } from '../../src/core/repository'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { QueryBuilder } from '../../src/core/query-builder'
import type { RowWithId } from '../../src/core/types'

interface TestRow extends RowWithId {
  id: number
  name: string
  category: string
  value: number
  status: string
}

describe('Large Dataset Behavior', () => {
  describe('Large dataset CRUD operations', () => {
    it('should handle 10,000 sequential inserts correctly', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        repo.create({
          name: `User ${i}`,
          category: `Category ${i % 10}`,
          value: i,
          status: i % 2 === 0 ? 'active' : 'inactive'
        })
      }
      console.log(`[Timing] 10,000 inserts: ${(performance.now() - start).toFixed(2)}ms`)

      expect(repo.count()).toBe(10000)
      // ids are unique and sequential
      expect(repo.findById(1)?.name).toBe('User 0')
      expect(repo.findById(10000)?.name).toBe('User 9999')
    })

    it('should batch insert 10,000 rows with unique ids', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: i % 2 === 0 ? 'active' : 'inactive'
      }))

      const start = performance.now()
      const results = repo.batchInsert(data)
      console.log(`[Timing] Batch insert 10,000: ${(performance.now() - start).toFixed(2)}ms`)

      expect(results.length).toBe(10000)
      const ids = new Set(results.map(r => r.id))
      expect(ids.size).toBe(10000) // all ids unique
    })

    it('should query large dataset with filters correctly', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: i % 3 === 0 ? 'active' : 'inactive'
      }))
      repo.batchInsert(data)

      const query = new QueryBuilder(adapter)
      const results = query
        .where('category', '=', 'Category 0')
        .where('status', '=', 'active')
        .exec()

      expect(results.length).toBeGreaterThan(0)
      // Every returned row must satisfy both filters.
      expect(results.every(r => r.category === 'Category 0' && r.status === 'active')).toBe(true)
      // Matches a manual scan.
      const expected = adapter.findAll().filter(r => r.category === 'Category 0' && r.status === 'active').length
      expect(results.length).toBe(expected)
    })

    it('should batch update many rows without touching the rest', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'pending'
      }))
      const inserted = repo.batchInsert(data)

      const updates = inserted.slice(0, 5000).map(row => ({
        id: row.id,
        data: { status: 'completed' }
      }))
      const results = repo.batchUpdate(updates)

      expect(results.length).toBe(5000)
      expect(results.every(r => r.status === 'completed')).toBe(true)
      // Untouched rows remain 'pending'.
      expect(repo.findById(inserted[5000].id)?.status).toBe('pending')
      expect(adapter.findAll().filter(r => r.status === 'completed').length).toBe(5000)
    })

    it('should findById correctly on a large dataset', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      // Spot-check lookups across the range return the right row.
      for (const id of [1, 2500, 5000, 7500, 10000]) {
        expect(repo.findById(id)?.id).toBe(id)
      }
      expect(adapter.findById(10001)).toBeUndefined()
    })
  })

  describe('Query behavior with sorting and pagination', () => {
    let adapter: MockAdapter<TestRow>
    let repo: Repository<TestRow>

    beforeEach(() => {
      adapter = new MockAdapter<TestRow>()
      repo = new Repository(adapter)

      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i % 1000,
        status: i % 2 === 0 ? 'active' : 'inactive'
      }))
      repo.batchInsert(data)
    })

    it('should sort large result sets correctly', () => {
      const query = new QueryBuilder(adapter)
      const results = query.orderBy('value', 'desc').exec()

      expect(results.length).toBe(5000)
      // Fully ordered, not just the first pair.
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].value).toBeGreaterThanOrEqual(results[i].value)
      }
    })

    it('should paginate without gaps or overlaps', () => {
      const pageSize = 50
      const totalPages = 20
      const seen: number[] = []

      for (let page = 0; page < totalPages; page++) {
        const query = new QueryBuilder(adapter)
        const results = query.orderBy('id', 'asc').offset(page * pageSize).limit(pageSize).exec()

        expect(results.length).toBe(pageSize)
        // ids start at 1 and are contiguous in id-asc order.
        expect(results[0].id).toBe(page * pageSize + 1)
        seen.push(...results.map(r => r.id))
      }
      expect(new Set(seen).size).toBe(totalPages * pageSize) // no overlaps
    })

    it('should handle complex multi-condition queries correctly', () => {
      const query = new QueryBuilder(adapter)
      const results = query
        .where('category', 'in', ['Category 1', 'Category 2', 'Category 3'])
        .where('value', '>', 500)
        .where('status', '=', 'active')
        .orderBy('value', 'desc')
        .limit(100)
        .exec()

      expect(results.length).toBeLessThanOrEqual(100)
      expect(results.every(r =>
        ['Category 1', 'Category 2', 'Category 3'].includes(r.category) &&
        r.value > 500 &&
        r.status === 'active'
      )).toBe(true)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].value).toBeGreaterThanOrEqual(results[i].value)
      }
    })
  })

  describe('Aggregation behavior', () => {
    let adapter: MockAdapter<TestRow>

    beforeEach(() => {
      adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 5}`,
        value: i % 1000,
        status: ['active', 'inactive', 'pending'][i % 3]
      }))
      repo.batchInsert(data)
    })

    it('should count with a filter correctly', () => {
      const count = new QueryBuilder(adapter).where('status', '=', 'active').count()
      const expected = adapter.findAll().filter(r => r.status === 'active').length
      expect(count).toBe(expected)
    })

    it('should sum and average correctly', () => {
      const all = adapter.findAll()
      const expectedSum = all.reduce((a, r) => a + r.value, 0)

      expect(new QueryBuilder(adapter).sum('value')).toBe(expectedSum)
      expect(new QueryBuilder(adapter).avg('value')).toBeCloseTo(expectedSum / all.length, 6)
    })

    it('should group by multiple fields covering all rows', () => {
      const results = new QueryBuilder(adapter)
        .groupBy('category', 'status')
        .agg({ count: 'count', avgValue: 'avg:value', sumValue: 'sum:value' })

      expect(results.length).toBeGreaterThan(0)
      // Group counts must sum to the full dataset.
      const total = results.reduce((a, g) => a + (g.count as number), 0)
      expect(total).toBe(adapter.findAll().length)
    })
  })

  describe('Stability', () => {
    it('should keep results correct across mixed operations', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      expect(repo.findAll().length).toBe(5000)
      new QueryBuilder(adapter).where('category', '=', 'Category 5').exec()
      repo.update(1, { status: 'inactive' })
      expect(repo.findById(1)?.status).toBe('inactive')
      expect(repo.count()).toBe(5000)
    })

    it('should return identical results across repeated queries (no degradation)', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      const data = Array.from({ length: 1000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 5}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      const counts = new Set<number>()
      for (let i = 0; i < 100; i++) {
        const results = new QueryBuilder(adapter).where('category', '=', 'Category 1').exec()
        counts.add(results.length)
      }
      // Every run returns the same count.
      expect(counts.size).toBe(1)
      expect([...counts][0]).toBe(adapter.findAll().filter(r => r.category === 'Category 1').length)
    })
  })

  describe('Scalability validation', () => {
    it('should return all rows for full scans at every size', () => {
      for (const size of [1000, 2000, 5000]) {
        const adapter = new MockAdapter<TestRow>()
        const repo = new Repository(adapter)

        const data = Array.from({ length: size }, (_, i) => ({
          name: `User ${i}`,
          category: `Category ${i % 10}`,
          value: i,
          status: 'active'
        }))
        repo.batchInsert(data)

        expect(repo.findAll().length).toBe(size)
      }
    })
  })
})
