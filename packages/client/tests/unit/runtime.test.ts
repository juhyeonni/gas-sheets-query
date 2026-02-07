/**
 * Runtime tests for @gsquery/client
 */

import { describe, it, expect } from 'vitest'
import { 
  createClientFactory, 
  createMockClient,
  isGASEnvironment,
  isNodeEnvironment,
  type GeneratedSchema
} from '../../src/runtime.js'

// =============================================================================
// Test Schema
// =============================================================================

const testSchema: GeneratedSchema = {
  tables: {
    User: {
      columns: ['id', 'name', 'email', 'age'] as const,
    },
    Post: {
      columns: ['id', 'title', 'content', 'userId'] as const,
      sheetName: 'Posts'
    }
  }
}

interface User {
  id: number
  name: string
  email: string
  age: number
}

interface Post {
  id: number
  title: string
  content: string
  userId: number
}

type TestTables = {
  User: User
  Post: Post
}

// =============================================================================
// Tests
// =============================================================================

describe('Environment Detection', () => {
  it('isGASEnvironment returns false in Node', () => {
    expect(isGASEnvironment()).toBe(false)
  })

  it('isNodeEnvironment returns true in Node', () => {
    expect(isNodeEnvironment()).toBe(true)
  })
})

describe('createClientFactory', () => {
  it('creates a client factory function', () => {
    const createClient = createClientFactory<TestTables>(testSchema)
    expect(typeof createClient).toBe('function')
  })

  it('factory returns a SheetsDB instance in mock mode', () => {
    const createClient = createClientFactory<TestTables>(testSchema)
    const db = createClient({ mock: true })
    
    expect(db).toBeDefined()
    expect(typeof db.from).toBe('function')
    expect(db.config).toBeDefined()
  })

  it('db.from returns table handle', () => {
    const createClient = createClientFactory<TestTables>(testSchema)
    const db = createClient({ mock: true })
    
    const users = db.from('User')
    expect(users).toBeDefined()
    expect(typeof users.findAll).toBe('function')
    expect(typeof users.create).toBe('function')
    expect(typeof users.query).toBe('function')
  })

  it('CRUD operations work with mock adapter', () => {
    const createClient = createClientFactory<TestTables>(testSchema)
    const db = createClient({ mock: true })
    
    // Create
    const user = db.from('User').create({
      name: 'Test User',
      email: 'test@example.com',
      age: 25
    })
    
    expect(user.id).toBeDefined()
    expect(user.name).toBe('Test User')
    
    // Read
    const found = db.from('User').findById(user.id)
    expect(found.email).toBe('test@example.com')
    
    // Update
    const updated = db.from('User').update(user.id, { age: 26 })
    expect(updated.age).toBe(26)
    
    // Delete
    db.from('User').delete(user.id)
    expect(() => db.from('User').findById(user.id)).toThrow()
  })

  it('query builder works', () => {
    const createClient = createClientFactory<TestTables>(testSchema)
    const db = createClient({ mock: true })
    
    // Create some users
    db.from('User').create({ name: 'Alice', email: 'alice@test.com', age: 30 })
    db.from('User').create({ name: 'Bob', email: 'bob@test.com', age: 25 })
    db.from('User').create({ name: 'Charlie', email: 'charlie@test.com', age: 35 })
    
    // Query
    const adults = db.from('User').query()
      .where('age', '>=', 30)
      .orderBy('name', 'asc')
      .exec()
    
    expect(adults.length).toBe(2)
    expect(adults[0].name).toBe('Alice')
    expect(adults[1].name).toBe('Charlie')
  })
})

describe('createMockClient', () => {
  it('creates a mock client directly', () => {
    const db = createMockClient<TestTables>(testSchema)
    
    expect(db).toBeDefined()
    expect(typeof db.from).toBe('function')
  })

  it('mock client supports all operations', () => {
    const db = createMockClient<TestTables>(testSchema)
    
    const post = db.from('Post').create({
      title: 'Hello World',
      content: 'This is a test',
      userId: 1
    })
    
    expect(post.id).toBeDefined()
    expect(post.title).toBe('Hello World')
    
    const posts = db.from('Post').findAll()
    expect(posts.length).toBe(1)
  })
})
