import { describe, it, expect, beforeEach } from 'vitest'
import { createSheetsDB, SheetsDB } from '../../src/core/sheets-db'
import { MockAdapter } from '../../src/adapters/mock-adapter'

interface User {
  id: number
  name: string
  email: string
  age: number
  active: boolean
}

interface Post {
  id: number
  title: string
  content: string
  userId: number
  published: boolean
}

describe('createSheetsDB', () => {
  let userAdapter: MockAdapter<User>
  let postAdapter: MockAdapter<Post>
  let db: SheetsDB<{ users: User; posts: Post }>

  beforeEach(() => {
    userAdapter = new MockAdapter<User>()
    postAdapter = new MockAdapter<Post>()
    
    db = createSheetsDB({
      config: {
        tables: {
          users: { columns: ['id', 'name', 'email', 'age', 'active'] },
          posts: { columns: ['id', 'title', 'content', 'userId', 'published'] }
        }
      },
      stores: {
        users: userAdapter,
        posts: postAdapter
      }
    })
  })

  describe('from', () => {
    it('should return a table handle', () => {
      const usersTable = db.from('users')
      expect(usersTable).toBeDefined()
      expect(usersTable.repo).toBeDefined()
    })

    it('should throw for unknown table', () => {
      expect(() => {
        // @ts-expect-error - testing runtime error
        db.from('unknown')
      }).toThrow('Table "unknown" not found. Available: users, posts')
    })

    it('should cache table handles', () => {
      const handle1 = db.from('users')
      const handle2 = db.from('users')
      expect(handle1).toBe(handle2)
    })
  })

  describe('TableHandle.create', () => {
    it('should create a new row', () => {
      const user = db.from('users').create({
        name: 'John',
        email: 'john@test.com',
        age: 30,
        active: true
      })
      
      expect(user.id).toBe(1)
      expect(user.name).toBe('John')
    })
  })

  describe('TableHandle.findById', () => {
    it('should find row by id', () => {
      db.from('users').create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      const user = db.from('users').findById(1)
      expect(user.name).toBe('John')
    })

    it('should throw for non-existent id', () => {
      expect(() => db.from('users').findById(999)).toThrow()
    })
  })

  describe('TableHandle.findAll', () => {
    it('should return all rows', () => {
      db.from('users').create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      db.from('users').create({ name: 'Jane', email: 'jane@test.com', age: 25, active: true })
      
      const users = db.from('users').findAll()
      expect(users.length).toBe(2)
    })
  })

  describe('TableHandle.update', () => {
    it('should update a row', () => {
      db.from('users').create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      const updated = db.from('users').update(1, { name: 'John Updated', age: 31 })
      
      expect(updated.name).toBe('John Updated')
      expect(updated.age).toBe(31)
      expect(updated.email).toBe('john@test.com')
    })
  })

  describe('TableHandle.delete', () => {
    it('should delete a row', () => {
      db.from('users').create({ name: 'John', email: 'john@test.com', age: 30, active: true })
      
      db.from('users').delete(1)
      
      expect(db.from('users').findAll().length).toBe(0)
    })
  })

  describe('TableHandle.query', () => {
    beforeEach(() => {
      db.from('users').create({ name: 'Alice', email: 'alice@test.com', age: 25, active: true })
      db.from('users').create({ name: 'Bob', email: 'bob@test.com', age: 30, active: false })
      db.from('users').create({ name: 'Charlie', email: 'charlie@test.com', age: 35, active: true })
    })

    it('should create a query builder', () => {
      const query = db.from('users').query()
      expect(query).toBeDefined()
    })

    it('should execute fluent queries', () => {
      const result = db.from('users')
        .query()
        .where('active', '=', true)
        .orderBy('age', 'desc')
        .exec()
      
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('Charlie')
      expect(result[1].name).toBe('Alice')
    })

    it('should support pagination', () => {
      const result = db.from('users')
        .query()
        .orderBy('id')
        .page(1, 2)
        .exec()
      
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('Alice')
      expect(result[1].name).toBe('Bob')
    })

    it('should support first()', () => {
      const user = db.from('users')
        .query()
        .where('active', '=', true)
        .orderBy('age')
        .first()
      
      expect(user?.name).toBe('Alice')
    })
  })

  describe('getStore', () => {
    it('should return the underlying store', () => {
      const store = db.getStore('users')
      expect(store).toBe(userAdapter)
    })

    it('should throw for unknown table', () => {
      expect(() => {
        // @ts-expect-error - testing runtime error
        db.getStore('unknown')
      }).toThrow('Store for table "unknown" not found')
    })
  })

  describe('multiple tables', () => {
    it('should work with related data', () => {
      // Create a user
      const user = db.from('users').create({
        name: 'John',
        email: 'john@test.com',
        age: 30,
        active: true
      })
      
      // Create posts for the user
      db.from('posts').create({ title: 'First Post', content: 'Hello', userId: user.id, published: true })
      db.from('posts').create({ title: 'Second Post', content: 'World', userId: user.id, published: false })
      
      // Query user's published posts
      const publishedPosts = db.from('posts')
        .query()
        .where('userId', '=', user.id)
        .where('published', '=', true)
        .exec()
      
      expect(publishedPosts.length).toBe(1)
      expect(publishedPosts[0].title).toBe('First Post')
    })
  })

  describe('config validation', () => {
    it('should throw if store is missing for a table', () => {
      expect(() => {
        createSheetsDB({
          config: {
            tables: {
              users: { columns: ['id', 'name'] },
              posts: { columns: ['id', 'title'] }
            }
          },
          stores: {
            users: new MockAdapter()
            // posts store is missing
          } as unknown as { users: MockAdapter<User>; posts: MockAdapter<Post> }
        })
      }).toThrow('Missing store for table "posts"')
    })
  })
})
