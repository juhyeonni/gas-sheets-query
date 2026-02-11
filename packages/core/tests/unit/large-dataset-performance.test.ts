/**
 * Large dataset performance tests for stability validation
 *
 * These tests verify that the system performs acceptably with large amounts of data.
 * While not strict benchmarks, they ensure operations complete within reasonable timeframes.
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

describe('Large Dataset Performance', () => {
  describe('Large dataset CRUD operations', () => {
    it('should handle 10,000 sequential inserts in reasonable time', () => {
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

      const duration = performance.now() - start

      expect(repo.count()).toBe(10000)
      expect(duration).toBeLessThan(1000) // Should complete in under 1 second

      console.log(`[Performance] 10,000 inserts: ${duration.toFixed(2)}ms`)
    })

    it('should handle batch insert of 10,000 rows efficiently', () => {
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
      const duration = performance.now() - start

      expect(results.length).toBe(10000)
      expect(duration).toBeLessThan(500) // Batch should be faster than sequential

      console.log(`[Performance] Batch insert 10,000: ${duration.toFixed(2)}ms`)
    })

    it('should efficiently query large dataset with filters', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Insert 10,000 rows
      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: i % 3 === 0 ? 'active' : 'inactive' // Use % 3 so there are matches
      }))
      repo.batchInsert(data)

      // Query with filters (Category 0, 3, 6, 9 will have active rows since i % 3 === 0 exists for those)
      const start = performance.now()
      const query = new QueryBuilder(adapter)
      const results = query
        .where('category', '=', 'Category 0')
        .where('status', '=', 'active')
        .exec()
      const duration = performance.now() - start

      expect(results.length).toBeGreaterThan(0)
      expect(duration).toBeLessThan(100) // Should be fast even without indexes

      console.log(`[Performance] Query 10,000 rows with filters: ${duration.toFixed(2)}ms, Results: ${results.length}`)
    })

    it('should handle batch update of many rows', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Insert 10,000 rows
      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'pending'
      }))
      const inserted = repo.batchInsert(data)

      // Batch update 5,000 rows
      const updates = inserted.slice(0, 5000).map(row => ({
        id: row.id,
        data: { status: 'completed' }
      }))

      const start = performance.now()
      const results = repo.batchUpdate(updates)
      const duration = performance.now() - start

      expect(results.length).toBe(5000)
      expect(duration).toBeLessThan(500)

      console.log(`[Performance] Batch update 5,000 rows: ${duration.toFixed(2)}ms`)
    })

    it('should handle findById lookups efficiently on large dataset', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Insert 10,000 rows
      const data = Array.from({ length: 10000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      // Perform 1,000 random lookups
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        const id = Math.floor(Math.random() * 10000) + 1
        repo.findById(id)
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(10) // O(1) lookups should be very fast

      console.log(`[Performance] 1,000 findById on 10,000 rows: ${duration.toFixed(2)}ms`)
    })
  })

  describe('Query performance with sorting and pagination', () => {
    let adapter: MockAdapter<TestRow>
    let repo: Repository<TestRow>

    beforeEach(() => {
      adapter = new MockAdapter<TestRow>()
      repo = new Repository(adapter)

      // Setup: Insert 5,000 rows
      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: Math.floor(Math.random() * 1000),
        status: i % 2 === 0 ? 'active' : 'inactive'
      }))
      repo.batchInsert(data)
    })

    it('should handle sorting large result sets', () => {
      const query = new QueryBuilder(adapter)

      const start = performance.now()
      const results = query
        .orderBy('value', 'desc')
        .exec()
      const duration = performance.now() - start

      expect(results.length).toBe(5000)
      expect(results[0].value).toBeGreaterThanOrEqual(results[1].value)
      expect(duration).toBeLessThan(50)

      console.log(`[Performance] Sort 5,000 rows: ${duration.toFixed(2)}ms`)
    })

    it('should efficiently paginate through large datasets', () => {
      const pageSize = 50
      const totalPages = 20

      const start = performance.now()
      for (let page = 0; page < totalPages; page++) {
        const query = new QueryBuilder(adapter)
        const results = query
          .orderBy('id', 'asc')
          .offset(page * pageSize)
          .limit(pageSize)
          .exec()

        expect(results.length).toBe(pageSize)
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // 20 pages should be fast

      console.log(`[Performance] Paginate ${totalPages} pages of ${pageSize}: ${duration.toFixed(2)}ms`)
    })

    it('should handle complex multi-condition queries', () => {
      const query = new QueryBuilder(adapter)

      const start = performance.now()
      const results = query
        .where('category', 'in', ['Category 1', 'Category 2', 'Category 3'])
        .where('value', '>', 500)
        .where('status', '=', 'active')
        .orderBy('value', 'desc')
        .limit(100)
        .exec()
      const duration = performance.now() - start

      expect(results.length).toBeLessThanOrEqual(100)
      expect(duration).toBeLessThan(50)

      console.log(`[Performance] Complex query on 5,000 rows: ${duration.toFixed(2)}ms`)
    })
  })

  describe('Aggregation performance', () => {
    let adapter: MockAdapter<TestRow>

    beforeEach(() => {
      adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Setup: Insert 5,000 rows with varied data
      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 5}`, // 5 categories
        value: Math.floor(Math.random() * 1000),
        status: ['active', 'inactive', 'pending'][i % 3]
      }))
      repo.batchInsert(data)
    })

    it('should perform count aggregation efficiently', () => {
      const query = new QueryBuilder(adapter)

      const start = performance.now()
      const count = query.where('status', '=', 'active').count()
      const duration = performance.now() - start

      expect(count).toBeGreaterThan(0)
      expect(duration).toBeLessThan(30)

      console.log(`[Performance] Count on 5,000 rows: ${duration.toFixed(2)}ms`)
    })

    it('should perform sum/avg aggregations efficiently', () => {
      const query = new QueryBuilder(adapter)

      const start = performance.now()
      const sum = query.sum('value')
      const avg = query.avg('value')
      const duration = performance.now() - start

      expect(sum).toBeGreaterThan(0)
      expect(avg).toBeGreaterThan(0)
      expect(duration).toBeLessThan(30)

      console.log(`[Performance] Sum+Avg on 5,000 rows: ${duration.toFixed(2)}ms`)
    })

    it('should handle group by with multiple groups', () => {
      const query = new QueryBuilder(adapter)

      const start = performance.now()
      const results = query
        .groupBy('category', 'status')
        .agg({
          count: 'count',
          avgValue: 'avg:value',
          sumValue: 'sum:value'
        })
      const duration = performance.now() - start

      expect(results.length).toBeGreaterThan(0)
      expect(duration).toBeLessThan(50)

      console.log(`[Performance] GroupBy on 5,000 rows: ${duration.toFixed(2)}ms, Groups: ${results.length}`)
    })
  })

  describe('Memory and stability', () => {
    it('should handle multiple operations on same large dataset', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Insert 5,000 rows
      const data = Array.from({ length: 5000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 10}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      const start = performance.now()

      // Perform multiple operations
      repo.findAll()

      const query1 = new QueryBuilder(adapter)
      query1.where('category', '=', 'Category 5').exec()

      repo.update(1, { status: 'inactive' })

      const query2 = new QueryBuilder(adapter)
      query2.orderBy('value', 'desc').limit(100).exec()

      repo.count()

      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)

      console.log(`[Performance] Multiple operations on 5,000 rows: ${duration.toFixed(2)}ms`)
    })

    it('should handle rapid repeated queries without degradation', () => {
      const adapter = new MockAdapter<TestRow>()
      const repo = new Repository(adapter)

      // Insert 1,000 rows
      const data = Array.from({ length: 1000 }, (_, i) => ({
        name: `User ${i}`,
        category: `Category ${i % 5}`,
        value: i,
        status: 'active'
      }))
      repo.batchInsert(data)

      const durations: number[] = []

      // Perform same query 100 times
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        const query = new QueryBuilder(adapter)
        query.where('category', '=', 'Category 1').exec()
        durations.push(performance.now() - start)
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
      const maxDuration = Math.max(...durations)

      expect(maxDuration).toBeLessThan(10) // No single query should be slow
      expect(avgDuration).toBeLessThan(5)  // Average should be very fast

      console.log(`[Performance] 100 repeated queries: avg ${avgDuration.toFixed(3)}ms, max ${maxDuration.toFixed(3)}ms`)
    })
  })

  describe('Scalability validation', () => {
    it('should confirm linear complexity for full scans', () => {
      const sizes = [1000, 2000, 5000]
      const timings: { size: number; time: number }[] = []

      for (const size of sizes) {
        const adapter = new MockAdapter<TestRow>()
        const repo = new Repository(adapter)

        // Insert data
        const data = Array.from({ length: size }, (_, i) => ({
          name: `User ${i}`,
          category: `Category ${i % 10}`,
          value: i,
          status: 'active'
        }))
        repo.batchInsert(data)

        // Measure findAll
        const start = performance.now()
        repo.findAll()
        const duration = performance.now() - start

        timings.push({ size, time: duration })
      }

      console.log('[Scalability] findAll() timing:', timings)

      // Verify reasonable performance at each size
      timings.forEach(({ size, time }) => {
        expect(time).toBeLessThan(size * 0.1) // Should be fast relative to size
      })
    })
  })
})
