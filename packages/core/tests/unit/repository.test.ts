import { describe, it, expect, beforeEach } from 'vitest'
import { Repository } from '../../src/core/repository'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { RowWithId } from '../../src/core/types'

interface User extends RowWithId {
  id: number
  name: string
  email: string
  age: number
  active: boolean
}

describe('Repository', () => {
  let adapter: MockAdapter<User>
  let repo: Repository<User>

  beforeEach(() => {
    adapter = new MockAdapter<User>()
    repo = new Repository(adapter)
  })

  describe('create', () => {
    it('should insert a new row with auto-generated id', () => {
      const user = repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      expect(user.id).toBe(1)
      expect(user.name).toBe('John')
      expect(user.email).toBe('john@test.com')
    })

    it('should increment id for each insert', () => {
      const user1 = repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      const user2 = repo.create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      
      expect(user1.id).toBe(1)
      expect(user2.id).toBe(2)
    })
  })

  describe('findById', () => {
    it('should find existing row', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      const user = repo.findById(1)
      expect(user.name).toBe('John')
    })

    it('should throw for non-existent row', () => {
      expect(() => repo.findById(999)).toThrow('Row with id "999" not found')
    })
  })

  describe('findByIdOrNull', () => {
    it('should return undefined for non-existent row', () => {
      const user = repo.findByIdOrNull(999)
      expect(user).toBeUndefined()
    })
  })

  describe('findAll', () => {
    it('should return all rows', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      repo.create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      
      const users = repo.findAll()
      expect(users.length).toBe(2)
    })

    it('should return empty array when no data', () => {
      expect(repo.findAll()).toEqual([])
    })
  })

  describe('update', () => {
    it('should update existing row', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      const updated = repo.update(1, { name: 'John Updated', age: 31 })
      
      expect(updated.name).toBe('John Updated')
      expect(updated.age).toBe(31)
      expect(updated.email).toBe('john@test.com') // unchanged
    })

    it('should throw for non-existent row', () => {
      expect(() => repo.update(999, { name: 'test' })).toThrow('Row with id "999" not found')
    })
  })

  describe('updateOrNull', () => {
    it('should return undefined for non-existent row', () => {
      const result = repo.updateOrNull(999, { name: 'test' })
      expect(result).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('should delete existing row', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      repo.delete(1)
      
      expect(repo.findByIdOrNull(1)).toBeUndefined()
    })

    it('should throw for non-existent row', () => {
      expect(() => repo.delete(999)).toThrow('Row with id "999" not found')
    })
  })

  describe('deleteIfExists', () => {
    it('should return false for non-existent row', () => {
      expect(repo.deleteIfExists(999)).toBe(false)
    })

    it('should return true when deleted', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      expect(repo.deleteIfExists(1)).toBe(true)
    })
  })

  describe('count', () => {
    it('should return 0 when empty', () => {
      expect(repo.count()).toBe(0)
    })

    it('should return correct count', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      repo.create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      expect(repo.count()).toBe(2)
    })
  })

  describe('exists', () => {
    it('should return false when not exists', () => {
      expect(repo.exists(999)).toBe(false)
    })

    it('should return true when exists', () => {
      repo.create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      expect(repo.exists(1)).toBe(true)
    })
  })
})
