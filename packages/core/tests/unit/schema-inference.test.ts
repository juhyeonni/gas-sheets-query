/**
 * Tests for schema-based type inference
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { defineSheetsDB, MockAdapter } from '../../src'

describe('defineSheetsDB - Schema Type Inference', () => {
  describe('basic usage', () => {
    it('should create a database with inferred types', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'email'] as const,
            types: { id: 0, name: '', email: '' }
          }
        },
        stores: {
          users: new MockAdapter()
        }
      })

      expect(db).toBeDefined()
      expect(db.from('users')).toBeDefined()
    })

    it('should allow CRUD operations with inferred types', () => {
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

      // Create
      const user = db.from('users').create({ name: 'John', email: 'john@test.com', age: 25 })
      expect(user.id).toBeDefined()
      expect(user.name).toBe('John')
      expect(user.age).toBe(25)

      // Read
      const found = db.from('users').findById(user.id)
      expect(found.name).toBe('John')

      // Update
      const updated = db.from('users').update(user.id, { age: 26 })
      expect(updated.age).toBe(26)

      // Delete
      db.from('users').delete(user.id)
      expect(() => db.from('users').findById(user.id)).toThrow()
    })

    it('should work with query builder', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'email', 'active'] as const,
            types: { id: 0, name: '', email: '', active: true }
          }
        },
        stores: {
          users: new MockAdapter()
        }
      })

      db.from('users').create({ name: 'Alice', email: 'alice@test.com', active: true })
      db.from('users').create({ name: 'Bob', email: 'bob@test.com', active: false })
      db.from('users').create({ name: 'Charlie', email: 'charlie@test.com', active: true })

      // Query with type-safe column names
      const activeUsers = db.from('users')
        .query()
        .where('active', '=', true)
        .orderBy('name', 'asc')
        .exec()

      expect(activeUsers).toHaveLength(2)
      expect(activeUsers[0].name).toBe('Alice')
      expect(activeUsers[1].name).toBe('Charlie')
    })
  })

  describe('multiple tables', () => {
    it('should handle multiple tables with different schemas', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'email'] as const,
            types: { id: 0, name: '', email: '' }
          },
          posts: {
            columns: ['id', 'title', 'userId', 'published'] as const,
            types: { id: 0, title: '', userId: 0, published: false }
          }
        },
        stores: {
          users: new MockAdapter(),
          posts: new MockAdapter()
        }
      })

      // Create user
      const user = db.from('users').create({ name: 'Author', email: 'author@test.com' })

      // Create posts
      db.from('posts').create({ title: 'First Post', userId: user.id as number, published: true })
      db.from('posts').create({ title: 'Draft', userId: user.id as number, published: false })

      // Query posts
      const publishedPosts = db.from('posts')
        .query()
        .where('published', '=', true)
        .exec()

      expect(publishedPosts).toHaveLength(1)
      expect(publishedPosts[0].title).toBe('First Post')
    })
  })

  describe('without type hints', () => {
    it('should work without types property (fallback to unknown)', () => {
      const db = defineSheetsDB({
        tables: {
          items: {
            columns: ['id', 'name', 'value'] as const
            // No types property - columns will be unknown
          }
        },
        stores: {
          items: new MockAdapter()
        }
      })

      // Still works, but types are unknown
      const item = db.from('items').create({ name: 'Test', value: 123 })
      expect(item.name).toBe('Test')
    })
  })

  describe('error handling', () => {
    it('should throw on invalid table name', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: {
          users: new MockAdapter()
        }
      })

      expect(() => db.from('invalid' as 'users')).toThrow('Table "invalid" not found')
    })

    it('should throw on missing store', () => {
      expect(() => {
        defineSheetsDB({
          tables: {
            users: {
              columns: ['id', 'name'] as const,
              types: { id: 0, name: '' }
            }
          },
          stores: {} as any
        })
      }).toThrow('Missing store for table "users"')
    })
  })

  describe('type inference verification', () => {
    it('should infer correct types from samples', () => {
      const db = defineSheetsDB({
        tables: {
          mixed: {
            columns: ['id', 'str', 'num', 'bool'] as const,
            types: {
              id: 0,
              str: 'sample',
              num: 42,
              bool: false
            }
          }
        },
        stores: {
          mixed: new MockAdapter()
        }
      })

      const row = db.from('mixed').create({
        str: 'hello',
        num: 100,
        bool: true
      })

      // TypeScript should infer these types correctly
      expect(typeof row.str).toBe('string')
      expect(typeof row.num).toBe('number')
      expect(typeof row.bool).toBe('boolean')
    })
  })
})
