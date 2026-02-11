/**
 * Type safety validation tests
 *
 * These tests verify that the type system correctly enforces compile-time
 * safety for schema-based database operations.
 */
import { describe, it, expect } from 'vitest'
import { defineSheetsDB, MockAdapter } from '../../src'

describe('Type Safety Validation', () => {
  describe('Schema type inference', () => {
    it('should infer correct row types from schema', () => {
      type UserRow = { id: number; name: string; email: string; age: number; active: boolean }

      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'email', 'age', 'active'] as const,
            types: {
              id: 0,
              name: '',
              email: '',
              age: 0,
              active: true
            }
          }
        },
        stores: {
          users: new MockAdapter<UserRow>()
        }
      })

      const user = db.from('users').create({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        active: true
      })

      expect(typeof user.id).toBe('number')
      expect(typeof user.name).toBe('string')
      expect(typeof user.email).toBe('string')
      expect(typeof user.age).toBe('number')
      expect(typeof user.active).toBe('boolean')
    })

    it('should enforce type safety in update operations', () => {
      type ProductRow = { id: number; name: string; price: number; inStock: boolean }

      const db = defineSheetsDB({
        tables: {
          products: {
            columns: ['id', 'name', 'price', 'inStock'] as const,
            types: { id: 0, name: '', price: 0, inStock: true }
          }
        },
        stores: {
          products: new MockAdapter<ProductRow>()
        }
      })

      const product = db.from('products').create({
        name: 'Widget',
        price: 19.99,
        inStock: true
      })

      const updated = db.from('products').update(product.id, {
        price: 24.99,
        inStock: false
      })

      expect(updated.price).toBe(24.99)
      expect(updated.inStock).toBe(false)
    })

    it('should enforce type safety in query where clauses', () => {
      const db = defineSheetsDB({
        tables: {
          orders: {
            columns: ['id', 'customerId', 'total', 'status'] as const,
            types: { id: 0, customerId: 0, total: 0, status: '' }
          }
        },
        mock: true
      })

      db.from('orders').create({ customerId: 1, total: 100, status: 'pending' })
      db.from('orders').create({ customerId: 1, total: 200, status: 'completed' })
      db.from('orders').create({ customerId: 2, total: 150, status: 'pending' })

      const query1 = db.from('orders')
        .query()
        .where('customerId', '=', 1)
        .exec()

      expect(query1.length).toBe(2)

      const query2 = db.from('orders')
        .query()
        .where('status', '=', 'pending')
        .where('total', '>', 50)
        .exec()

      expect(query2.length).toBe(2)
    })

    it('should enforce type safety in orderBy', () => {
      const db = defineSheetsDB({
        tables: {
          items: {
            columns: ['id', 'name', 'value'] as const,
            types: { id: 0, name: '', value: 0 }
          }
        },
        mock: true
      })

      db.from('items').create({ name: 'Item A', value: 100 })
      db.from('items').create({ name: 'Item B', value: 50 })

      const sorted = db.from('items')
        .query()
        .orderBy('value', 'desc')
        .exec()

      expect(sorted[0].value).toBeGreaterThan(sorted[1].value)
    })
  })

  describe('Multiple table type safety', () => {
    it('should maintain separate types for different tables', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'username', 'email'] as const,
            types: { id: 0, username: '', email: '' }
          },
          posts: {
            columns: ['id', 'title', 'userId', 'published'] as const,
            types: { id: 0, title: '', userId: 0, published: false }
          }
        },
        mock: true
      })

      const user = db.from('users').create({
        username: 'john',
        email: 'john@example.com'
      })

      const post = db.from('posts').create({
        title: 'Hello World',
        userId: user.id as number,
        published: true
      })

      expect(user).toHaveProperty('username')
      expect(user).not.toHaveProperty('title')
      expect(post).toHaveProperty('title')
      expect(post).not.toHaveProperty('username')
    })
  })

  describe('InferRowFromSchema type utility', () => {
    it('should correctly infer types from schema definition', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name', 'age', 'active'] as const,
            types: { id: 0, name: '', age: 0, active: true }
          }
        },
        mock: true
      })

      const user = db.from('users').create({
        name: 'Test',
        age: 25,
        active: true
      })

      expect(typeof user.id).toBe('number')
      expect(typeof user.name).toBe('string')
      expect(typeof user.age).toBe('number')
      expect(typeof user.active).toBe('boolean')
    })

    it('should handle schemas without type hints', () => {
      const db = defineSheetsDB({
        tables: {
          items: {
            columns: ['id', 'data'] as const
          }
        },
        mock: true
      })

      const item = db.from('items').create({ data: 'anything' })

      expect(item.id).toBeDefined()
      expect(item.data).toBe('anything')
    })
  })

  describe('InferTablesFromConfig type utility', () => {
    it('should correctly infer all table types from config', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          },
          posts: {
            columns: ['id', 'title', 'userId'] as const,
            types: { id: 0, title: '', userId: 0 }
          }
        },
        mock: true
      })

      const user = db.from('users').create({ name: 'John' })
      const post = db.from('posts').create({ title: 'Hello', userId: user.id as number })

      expect(user.name).toBe('John')
      expect(post.title).toBe('Hello')
      expect(post.userId).toBe(user.id)
    })
  })

  describe('Query builder type safety', () => {
    it('should enforce correct types in aggregations', () => {
      const db = defineSheetsDB({
        tables: {
          sales: {
            columns: ['id', 'product', 'amount', 'quantity'] as const,
            types: { id: 0, product: '', amount: 0, quantity: 0 }
          }
        },
        mock: true
      })

      db.from('sales').create({ product: 'Widget', amount: 100, quantity: 5 })
      db.from('sales').create({ product: 'Widget', amount: 200, quantity: 10 })
      db.from('sales').create({ product: 'Gadget', amount: 150, quantity: 7 })

      const total = db.from('sales').query().sum('amount')
      expect(total).toBeGreaterThan(0)

      const avgQuantity = db.from('sales').query().avg('quantity')
      expect(avgQuantity).toBeGreaterThan(0)
    })

    it('should enforce type safety in IN operator', () => {
      const db = defineSheetsDB({
        tables: {
          categories: {
            columns: ['id', 'name', 'priority'] as const,
            types: { id: 0, name: '', priority: 0 }
          }
        },
        mock: true
      })

      db.from('categories').create({ name: 'Electronics', priority: 1 })
      db.from('categories').create({ name: 'Books', priority: 2 })
      db.from('categories').create({ name: 'Clothing', priority: 3 })

      const results = db.from('categories')
        .query()
        .where('name', 'in', ['Electronics', 'Books'])
        .exec()

      expect(results.length).toBe(2)
    })
  })

  describe('mock: true option', () => {
    it('should auto-create MockAdapter stores when mock: true', () => {
      const db = defineSheetsDB({
        tables: {
          test: {
            columns: ['id', 'str', 'num', 'bool'] as const,
            types: { id: 0, str: '', num: 0, bool: false }
          }
        },
        mock: true
      })

      const row = db.from('test').create({ str: 'hello', num: 42, bool: true })
      expect(row.id).toBe(1)
      expect(row.str).toBe('hello')
      expect(row.num).toBe(42)
      expect(row.bool).toBe(true)

      const found = db.from('test').findById(1)
      expect(found.str).toBe('hello')
    })

    it('should throw when neither stores nor mock is provided', () => {
      expect(() => {
        defineSheetsDB({
          tables: {
            test: {
              columns: ['id', 'data'] as const,
              types: { id: 0, data: '' }
            }
          }
        })
      }).toThrow('defineSheetsDB requires either "stores" or "mock: true"')
    })
  })
})
