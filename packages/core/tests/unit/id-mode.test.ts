import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'

interface User {
  id: string | number
  name: string
  email: string
}

describe('idMode option', () => {
  describe('auto mode (default)', () => {
    let adapter: MockAdapter<User>

    beforeEach(() => {
      adapter = new MockAdapter<User>()
    })

    it('should auto-generate numeric IDs', () => {
      const user1 = adapter.insert({ name: 'John', email: 'john@test.com' })
      const user2 = adapter.insert({ name: 'Jane', email: 'jane@test.com' })

      expect(user1.id).toBe(1)
      expect(user2.id).toBe(2)
    })

    it('should auto-generate IDs in batch insert', () => {
      const users = adapter.batchInsert([
        { name: 'John', email: 'john@test.com' },
        { name: 'Jane', email: 'jane@test.com' }
      ])

      expect(users[0].id).toBe(1)
      expect(users[1].id).toBe(2)
    })

    it('should continue ID sequence after initial data', () => {
      const adapterWithData = new MockAdapter<User>({
        initialData: [
          { id: 100, name: 'Existing', email: 'existing@test.com' }
        ]
      })

      const newUser = adapterWithData.insert({ name: 'New', email: 'new@test.com' })
      expect(newUser.id).toBe(101)
    })
  })

  describe('client mode', () => {
    let adapter: MockAdapter<User>

    beforeEach(() => {
      adapter = new MockAdapter<User>({ idMode: 'client' })
    })

    it('should use client-provided string ID', () => {
      const user = adapter.insert({ 
        id: 'uuid-12345', 
        name: 'John', 
        email: 'john@test.com' 
      } as User)

      expect(user.id).toBe('uuid-12345')
      expect(adapter.findById('uuid-12345')).toEqual(user)
    })

    it('should use client-provided numeric ID', () => {
      const user = adapter.insert({ 
        id: 999, 
        name: 'John', 
        email: 'john@test.com' 
      } as User)

      expect(user.id).toBe(999)
      expect(adapter.findById(999)).toEqual(user)
    })

    it('should throw error when ID is missing in client mode', () => {
      expect(() => {
        adapter.insert({ name: 'John', email: 'john@test.com' })
      }).toThrow("ID is required in client mode (idMode: 'client')")
    })

    it('should support UUID-style IDs', () => {
      const uuid1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const uuid2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'

      adapter.insert({ id: uuid1, name: 'User1', email: 'user1@test.com' } as User)
      adapter.insert({ id: uuid2, name: 'User2', email: 'user2@test.com' } as User)

      expect(adapter.findById(uuid1)?.name).toBe('User1')
      expect(adapter.findById(uuid2)?.name).toBe('User2')
    })

    it('should use client IDs in batch insert', () => {
      const users = adapter.batchInsert([
        { id: 'id-001', name: 'John', email: 'john@test.com' },
        { id: 'id-002', name: 'Jane', email: 'jane@test.com' }
      ] as User[])

      expect(users[0].id).toBe('id-001')
      expect(users[1].id).toBe('id-002')
    })

    it('should throw error in batch insert when ID is missing', () => {
      expect(() => {
        adapter.batchInsert([
          { id: 'id-001', name: 'John', email: 'john@test.com' },
          { name: 'Jane', email: 'jane@test.com' }  // missing ID
        ] as User[])
      }).toThrow("ID is required in client mode (idMode: 'client')")
    })

    it('should support update with string ID', () => {
      adapter.insert({ id: 'uuid-123', name: 'John', email: 'john@test.com' } as User)
      
      const updated = adapter.update('uuid-123', { name: 'John Updated' })
      
      expect(updated?.name).toBe('John Updated')
      expect(updated?.id).toBe('uuid-123')
    })

    it('should support delete with string ID', () => {
      adapter.insert({ id: 'uuid-123', name: 'John', email: 'john@test.com' } as User)
      
      expect(adapter.delete('uuid-123')).toBe(true)
      expect(adapter.findById('uuid-123')).toBeUndefined()
    })

    it('should work with reset', () => {
      adapter.reset([
        { id: 'custom-1', name: 'User1', email: 'user1@test.com' },
        { id: 'custom-2', name: 'User2', email: 'user2@test.com' }
      ])

      expect(adapter.findAll().length).toBe(2)
      expect(adapter.findById('custom-1')?.name).toBe('User1')
    })
  })

  describe('backward compatibility', () => {
    it('should default to auto mode when no options provided', () => {
      const adapter = new MockAdapter<User>()
      const user = adapter.insert({ name: 'John', email: 'john@test.com' })
      
      expect(user.id).toBe(1)
    })

    it('should default to auto mode with array initialData', () => {
      const adapter = new MockAdapter<User>([
        { id: 1, name: 'Existing', email: 'existing@test.com' }
      ])
      
      const newUser = adapter.insert({ name: 'New', email: 'new@test.com' })
      expect(newUser.id).toBe(2)
    })

    it('should default to auto mode with options object without idMode', () => {
      const adapter = new MockAdapter<User>({
        initialData: [{ id: 1, name: 'Existing', email: 'existing@test.com' }]
      })
      
      const newUser = adapter.insert({ name: 'New', email: 'new@test.com' })
      expect(newUser.id).toBe(2)
    })
  })
})
