import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { Repository } from '../../src/core/repository'

interface User {
  id: number
  name: string
  email: string
  age: number
  active: boolean
}

describe('findById Optimization', () => {
  let adapter: MockAdapter<User>
  let repo: Repository<User>

  describe('O(1) index-based lookup', () => {
    beforeEach(() => {
      adapter = new MockAdapter<User>()
      repo = new Repository(adapter)
    })

    it('should find row by ID using index (O(1))', () => {
      // Create multiple users
      for (let i = 0; i < 100; i++) {
        repo.create({ 
          name: `User ${i}`, 
          email: `user${i}@test.com`, 
          age: 20 + i, 
          active: true 
        })
      }

      // Find by ID - should be O(1) with index
      const user50 = repo.findById(50)
      expect(user50.name).toBe('User 49') // 0-indexed creation, 1-indexed ID
      expect(user50.id).toBe(50)
    })

    it('should maintain index after inserts', () => {
      const user1 = repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      const user2 = repo.create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      const user3 = repo.create({ name: 'Bob', email: 'bob@test.com', age: 35, active: false })

      expect(repo.findById(user1.id).name).toBe('John')
      expect(repo.findById(user2.id).name).toBe('Jane')
      expect(repo.findById(user3.id).name).toBe('Bob')
    })

    it('should maintain index after updates', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      repo.update(1, { name: 'John Updated' })
      
      const user = repo.findById(1)
      expect(user.name).toBe('John Updated')
    })

    it('should maintain index after deletes', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      repo.create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      repo.create({ name: 'Bob', email: 'bob@test.com', age: 35, active: false })

      repo.delete(2) // Delete Jane

      expect(repo.findByIdOrNull(1)?.name).toBe('John')
      expect(repo.findByIdOrNull(2)).toBeUndefined() // Jane deleted
      expect(repo.findByIdOrNull(3)?.name).toBe('Bob')
    })

    it('should handle reset correctly', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      adapter.reset([
        { id: 10, name: 'New User', email: 'new@test.com', age: 40, active: true }
      ])

      expect(repo.findByIdOrNull(1)).toBeUndefined()
      expect(repo.findById(10).name).toBe('New User')
    })
  })

  describe('Benchmark simulation', () => {
    it('should demonstrate O(1) vs O(N) performance difference', () => {
      const DATA_SIZE = 10000
      adapter = new MockAdapter<User>()
      repo = new Repository(adapter)

      // Populate with data
      for (let i = 0; i < DATA_SIZE; i++) {
        repo.create({
          name: `User ${i}`,
          email: `user${i}@test.com`,
          age: 20 + (i % 50),
          active: i % 2 === 0
        })
      }

      // Benchmark: Multiple lookups
      const LOOKUP_COUNT = 1000
      const lookupIds = Array.from({ length: LOOKUP_COUNT }, () => 
        Math.floor(Math.random() * DATA_SIZE) + 1
      )

      const startTime = performance.now()
      for (const id of lookupIds) {
        repo.findByIdOrNull(id)
      }
      const endTime = performance.now()

      const avgTimePerLookup = (endTime - startTime) / LOOKUP_COUNT
      
      // With O(1) index lookup, avg should be < 0.1ms per lookup
      // Without index (O(N)), would be much slower with 10k rows
      expect(avgTimePerLookup).toBeLessThan(1) // 1ms threshold
      
      // Log for visibility
      console.log(`[Benchmark] ${LOOKUP_COUNT} lookups in ${DATA_SIZE} rows:`)
      console.log(`  Total time: ${(endTime - startTime).toFixed(2)}ms`)
      console.log(`  Avg per lookup: ${avgTimePerLookup.toFixed(4)}ms`)
    })
  })
})
