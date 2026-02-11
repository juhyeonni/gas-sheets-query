import { describe, it, expect, beforeEach } from 'vitest'
import { QueryBuilder, createQueryBuilder } from '../../src/core/query-builder'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { RowWithId } from '../../src/core/types'

interface Order extends RowWithId {
  id: number
  category: string
  status: string
  amount: number
  quantity: number
}

describe('Aggregation Functions', () => {
  let adapter: MockAdapter<Order>
  let query: QueryBuilder<Order>

  beforeEach(() => {
    adapter = new MockAdapter<Order>()
    
    // Insert test data
    adapter.insert({ category: 'electronics', status: 'completed', amount: 100, quantity: 1 })
    adapter.insert({ category: 'electronics', status: 'completed', amount: 200, quantity: 2 })
    adapter.insert({ category: 'electronics', status: 'pending', amount: 150, quantity: 1 })
    adapter.insert({ category: 'books', status: 'completed', amount: 50, quantity: 3 })
    adapter.insert({ category: 'books', status: 'completed', amount: 30, quantity: 2 })
    adapter.insert({ category: 'books', status: 'cancelled', amount: 25, quantity: 1 })
    adapter.insert({ category: 'clothing', status: 'completed', amount: 80, quantity: 2 })
    adapter.insert({ category: 'clothing', status: 'pending', amount: 120, quantity: 1 })
    
    query = createQueryBuilder(adapter)
  })

  describe('Simple Aggregations', () => {
    describe('count', () => {
      it('should count all rows', () => {
        expect(query.count()).toBe(8)
      })

      it('should count filtered rows', () => {
        expect(query.where('status', '=', 'completed').count()).toBe(5)
      })
    })

    describe('sum', () => {
      it('should sum all values', () => {
        expect(query.sum('amount')).toBe(755)
      })

      it('should sum filtered values', () => {
        expect(query.where('status', '=', 'completed').sum('amount')).toBe(460)
      })

      it('should return 0 for empty results', () => {
        expect(query.where('status', '=', 'nonexistent').sum('amount')).toBe(0)
      })
    })

    describe('avg', () => {
      it('should calculate average', () => {
        // 755 / 8 = 94.375
        expect(query.avg('amount')).toBeCloseTo(94.375)
      })

      it('should calculate filtered average', () => {
        // completed: 100 + 200 + 50 + 30 + 80 = 460 / 5 = 92
        expect(query.where('status', '=', 'completed').avg('amount')).toBe(92)
      })

      it('should return null for empty results', () => {
        expect(query.where('status', '=', 'nonexistent').avg('amount')).toBeNull()
      })
    })

    describe('min', () => {
      it('should find minimum value', () => {
        expect(query.min('amount')).toBe(25)
      })

      it('should find minimum of filtered values', () => {
        expect(query.where('category', '=', 'electronics').min('amount')).toBe(100)
      })

      it('should return null for empty results', () => {
        expect(query.where('status', '=', 'nonexistent').min('amount')).toBeNull()
      })
    })

    describe('max', () => {
      it('should find maximum value', () => {
        expect(query.max('amount')).toBe(200)
      })

      it('should find maximum of filtered values', () => {
        expect(query.where('category', '=', 'books').max('amount')).toBe(50)
      })

      it('should return null for empty results', () => {
        expect(query.where('status', '=', 'nonexistent').max('amount')).toBeNull()
      })
    })
  })

  describe('groupBy', () => {
    it('should group and aggregate by category', () => {
      const result = query
        .groupBy('category')
        .agg({ count: 'count', total: 'sum:amount' })
      
      expect(result.length).toBe(3)
      
      const electronics = result.find(r => r.category === 'electronics')
      expect(electronics?.count).toBe(3)
      expect(electronics?.total).toBe(450)
      
      const books = result.find(r => r.category === 'books')
      expect(books?.count).toBe(3)
      expect(books?.total).toBe(105)
      
      const clothing = result.find(r => r.category === 'clothing')
      expect(clothing?.count).toBe(2)
      expect(clothing?.total).toBe(200)
    })

    it('should group by status with avg', () => {
      const result = query
        .groupBy('status')
        .agg({ count: 'count', avgAmount: 'avg:amount' })
      
      expect(result.length).toBe(3)
      
      const completed = result.find(r => r.status === 'completed')
      expect(completed?.count).toBe(5)
      expect(completed?.avgAmount).toBe(92)
    })

    it('should work with where + groupBy', () => {
      const result = query
        .where('status', '=', 'completed')
        .groupBy('category')
        .agg({ count: 'count', total: 'sum:amount' })
      
      expect(result.length).toBe(3)
      
      const electronics = result.find(r => r.category === 'electronics')
      expect(electronics?.count).toBe(2)
      expect(electronics?.total).toBe(300)
    })

    it('should support min and max in agg', () => {
      const result = query
        .groupBy('category')
        .agg({ 
          count: 'count', 
          minAmount: 'min:amount', 
          maxAmount: 'max:amount' 
        })
      
      const electronics = result.find(r => r.category === 'electronics')
      expect(electronics?.minAmount).toBe(100)
      expect(electronics?.maxAmount).toBe(200)
    })
  })

  describe('having', () => {
    it('should filter groups by count', () => {
      const result = query
        .groupBy('category')
        .having('count', '>=', 3)
        .agg({ count: 'count', total: 'sum:amount' })
      
      // electronics: 3, books: 3, clothing: 2
      expect(result.length).toBe(2)
      expect(result.map(r => r.category)).toContain('electronics')
      expect(result.map(r => r.category)).toContain('books')
    })

    it('should filter groups by sum', () => {
      const result = query
        .groupBy('category')
        .having('total', '>', 200)
        .agg({ count: 'count', total: 'sum:amount' })
      
      // electronics: 450, books: 105, clothing: 200
      expect(result.length).toBe(1)
      expect(result[0].category).toBe('electronics')
    })

    it('should support multiple having conditions', () => {
      const result = query
        .groupBy('category')
        .having('count', '>=', 2)
        .having('total', '>', 150)
        .agg({ count: 'count', total: 'sum:amount' })
      
      // electronics: count=3, total=450 ✓
      // books: count=3, total=105 ✗ (total <= 150)
      // clothing: count=2, total=200 ✓
      expect(result.length).toBe(2)
    })

    it('should work with equality operator', () => {
      const result = query
        .groupBy('category')
        .having('count', '=', 3)
        .agg({ count: 'count' })
      
      expect(result.length).toBe(2)
    })
  })

  describe('agg without groupBy', () => {
    it('should return single aggregation result', () => {
      const result = query.agg({ 
        count: 'count', 
        total: 'sum:amount',
        avg: 'avg:amount',
        min: 'min:amount',
        max: 'max:amount'
      })
      
      expect(result.length).toBe(1)
      expect(result[0].count).toBe(8)
      expect(result[0].total).toBe(755)
      expect(result[0].avg).toBeCloseTo(94.375)
      expect(result[0].min).toBe(25)
      expect(result[0].max).toBe(200)
    })

    it('should work with where filter', () => {
      const result = query
        .where('category', '=', 'electronics')
        .agg({ count: 'count', total: 'sum:amount' })
      
      expect(result.length).toBe(1)
      expect(result[0].count).toBe(3)
      expect(result[0].total).toBe(450)
    })
  })

  describe('clone with aggregation state', () => {
    it('should preserve groupBy and having in clone', () => {
      const original = query
        .groupBy('category')
        .having('count', '>', 2)
      
      const cloned = original.clone()
      
      const originalResult = original.agg({ count: 'count' })
      const clonedResult = cloned.agg({ count: 'count' })
      
      expect(originalResult.length).toBe(clonedResult.length)
    })
  })

  describe('edge cases', () => {
    it('should handle empty dataset', () => {
      const emptyAdapter = new MockAdapter<Order>()
      const emptyQuery = createQueryBuilder(emptyAdapter)
      
      expect(emptyQuery.count()).toBe(0)
      expect(emptyQuery.sum('amount')).toBe(0)
      expect(emptyQuery.avg('amount')).toBeNull()
      expect(emptyQuery.min('amount')).toBeNull()
      expect(emptyQuery.max('amount')).toBeNull()
    })

    it('should handle single row', () => {
      const singleAdapter = new MockAdapter<Order>()
      singleAdapter.insert({ category: 'test', status: 'done', amount: 100, quantity: 1 })
      const singleQuery = createQueryBuilder(singleAdapter)
      
      expect(singleQuery.count()).toBe(1)
      expect(singleQuery.sum('amount')).toBe(100)
      expect(singleQuery.avg('amount')).toBe(100)
      expect(singleQuery.min('amount')).toBe(100)
      expect(singleQuery.max('amount')).toBe(100)
    })

    it('should handle groupBy with no matching groups', () => {
      const result = query
        .where('status', '=', 'nonexistent')
        .groupBy('category')
        .agg({ count: 'count' })
      
      expect(result.length).toBe(0)
    })
  })
})
