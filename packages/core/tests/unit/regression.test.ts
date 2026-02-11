/**
 * Regression tests for issues fixed in PR #62
 *
 * Each test documents which issue it prevents from recurring.
 * These tests should fail if the corresponding fix is reverted.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { createQueryBuilder } from '../../src/core/query-builder'
import { defineSheetsDB } from '../../src/core/sheets-db'
import { createMigrationRunner } from '../../src/core/migration'
import { JoinQueryBuilder } from '../../src/core/join-query-builder'
import type { RowWithId, DataStore } from '../../src/core/types'

// ---------------------------------------------------------------------------
// #49 - like operator crashes on regex special characters
// ---------------------------------------------------------------------------

describe('Regression: #49 - like operator with regex special chars', () => {
  interface TestRow extends RowWithId {
    id: number
    name: string
    value: string
  }

  let adapter: MockAdapter<TestRow>

  beforeEach(() => {
    adapter = new MockAdapter<TestRow>()
    adapter.insert({ name: 'test[1]', value: 'a' })
    adapter.insert({ name: 'test(2)', value: 'b' })
    adapter.insert({ name: 'test.3', value: 'c' })
    adapter.insert({ name: 'price$10', value: 'd' })
    adapter.insert({ name: 'a+b=c', value: 'e' })
    adapter.insert({ name: 'what?', value: 'f' })
    adapter.insert({ name: 'star*power', value: 'g' })
    adapter.insert({ name: 'pipe|line', value: 'h' })
    adapter.insert({ name: 'caret^top', value: 'i' })
    adapter.insert({ name: 'back\\slash', value: 'j' })
  })

  it('should not crash on square brackets', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'test[1]').exec()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test[1]')
  })

  it('should not crash on parentheses', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'test(2)').exec()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test(2)')
  })

  it('should not crash on dot', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'test.3').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on dollar sign', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'price$10').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on plus sign', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'a+b=c').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on question mark', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'what?').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on asterisk', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'star*power').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on pipe', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'pipe|line').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on caret', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'caret^top').exec()
    expect(result).toHaveLength(1)
  })

  it('should not crash on backslash', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'back\\slash').exec()
    expect(result).toHaveLength(1)
  })

  it('should still support % wildcard with special chars', () => {
    const query = createQueryBuilder(adapter)
    const result = query.whereLike('name', 'test%').exec()
    expect(result).toHaveLength(3) // test[1], test(2), test.3
  })
})

// ---------------------------------------------------------------------------
// #50 - SheetsAdapter.batchUpdate fails with string IDs
// ---------------------------------------------------------------------------

describe('Regression: #50 - batchUpdate with string IDs', () => {
  interface StringIdRow extends RowWithId {
    id: string
    name: string
    value: string
  }

  it('should update rows with string IDs', () => {
    const adapter = new MockAdapter<StringIdRow>({ idMode: 'client' })
    adapter.insert({ id: 'abc-1', name: 'Alice', value: 'v1' })
    adapter.insert({ id: 'abc-2', name: 'Bob', value: 'v2' })
    adapter.insert({ id: 'abc-3', name: 'Charlie', value: 'v3' })

    const results = adapter.batchUpdate([
      { id: 'abc-1', data: { name: 'Alice Updated' } },
      { id: 'abc-3', data: { value: 'v3-updated' } }
    ])

    expect(results).toHaveLength(2)
    expect(results[0].name).toBe('Alice Updated')
    expect(results[1].value).toBe('v3-updated')
  })

  it('should update rows with UUID-style string IDs', () => {
    const adapter = new MockAdapter<StringIdRow>({ idMode: 'client' })
    const uuid1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const uuid2 = 'f1e2d3c4-b5a6-0987-fedc-ba0987654321'

    adapter.insert({ id: uuid1, name: 'User1', value: 'v1' })
    adapter.insert({ id: uuid2, name: 'User2', value: 'v2' })

    const results = adapter.batchUpdate([
      { id: uuid1, data: { name: 'Updated1' } }
    ])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Updated1')
    expect(results[0].id).toBe(uuid1)
  })
})

// ---------------------------------------------------------------------------
// #52 - limit(0) behavior inconsistent between adapters
// ---------------------------------------------------------------------------

describe('Regression: #52 - limit(0) returns empty array', () => {
  interface TestRow extends RowWithId {
    id: number
    name: string
  }

  it('should return empty array with limit(0) on MockAdapter', () => {
    const adapter = new MockAdapter<TestRow>()
    adapter.insert({ name: 'Alice' })
    adapter.insert({ name: 'Bob' })

    const query = createQueryBuilder(adapter)
    const result = query.limit(0).exec()

    expect(result).toEqual([])
  })

  it('should return empty array with limit(0) through defineSheetsDB', () => {
    const db = defineSheetsDB({
      tables: {
        test: {
          columns: ['id', 'name'] as const,
          types: { id: 0, name: '' }
        }
      },
      mock: true
    })

    db.from('test').create({ name: 'Alice' })
    db.from('test').create({ name: 'Bob' })

    const result = db.from('test').query().limit(0).exec()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #56 - Aggregation methods mutate internal state
// ---------------------------------------------------------------------------

describe('Regression: #56 - aggregation methods should not mutate QueryBuilder state', () => {
  interface TestRow extends RowWithId {
    id: number
    name: string
    amount: number
  }

  let adapter: MockAdapter<TestRow>

  beforeEach(() => {
    adapter = new MockAdapter<TestRow>()
    adapter.insert({ name: 'Alice', amount: 100 })
    adapter.insert({ name: 'Bob', amount: 200 })
    adapter.insert({ name: 'Charlie', amount: 300 })
  })

  it('should allow exec() after count() on same builder', () => {
    const query = createQueryBuilder(adapter)
    const count = query.count()
    const results = query.exec()

    expect(count).toBe(3)
    expect(results).toHaveLength(3)
  })

  it('should allow exec() after sum() on same builder', () => {
    const query = createQueryBuilder(adapter)
    const sum = query.sum('amount')
    const results = query.exec()

    expect(sum).toBe(600)
    expect(results).toHaveLength(3)
  })

  it('should allow exec() after avg() on same builder', () => {
    const query = createQueryBuilder(adapter)
    const avg = query.avg('amount')
    const results = query.exec()

    expect(avg).toBe(200)
    expect(results).toHaveLength(3)
  })

  it('should allow exec() after min() on same builder', () => {
    const query = createQueryBuilder(adapter)
    const min = query.min('amount')
    const results = query.exec()

    expect(min).toBe(100)
    expect(results).toHaveLength(3)
  })

  it('should allow exec() after max() on same builder', () => {
    const query = createQueryBuilder(adapter)
    const max = query.max('amount')
    const results = query.exec()

    expect(max).toBe(300)
    expect(results).toHaveLength(3)
  })

  it('should allow chaining multiple aggregations without mutation', () => {
    const query = createQueryBuilder(adapter).where('amount', '>', 100)

    const count = query.count()
    const sum = query.sum('amount')
    const results = query.exec()

    expect(count).toBe(2)
    expect(sum).toBe(500)
    expect(results).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// #57 - Migration removeColumn doesn't actually remove data
// ---------------------------------------------------------------------------

describe('Regression: #57 - removeColumn clears data from rows', () => {
  it('should set removed column values to undefined', async () => {
    interface TestRow extends RowWithId {
      id: number
      name: string
      email?: string
    }

    const adapter = new MockAdapter<TestRow>()
    adapter.insert({ name: 'Alice', email: 'alice@test.com' })
    adapter.insert({ name: 'Bob', email: 'bob@test.com' })

    // MigrationRunner requires a migrationsStore to track applied versions
    const migrationsStore = new MockAdapter<RowWithId>()

    const runner = createMigrationRunner({
      migrationsStore: migrationsStore as DataStore<any>,
      storeResolver: () => adapter as unknown as DataStore<RowWithId>,
      migrations: [
        {
          version: 1,
          name: 'remove_email',
          up(schema) {
            schema.removeColumn('test', 'email')
          },
          down(schema) {
            schema.addColumn('test', 'email', { type: 'string' })
          }
        }
      ]
    })

    await runner.migrate()

    const rows = adapter.findAll()
    for (const row of rows) {
      expect(row.email).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// #58 - JoinQueryBuilder silently strips foreign table prefix
// ---------------------------------------------------------------------------

describe('Regression: #58 - JoinQueryBuilder throws on foreign field filter', () => {
  interface UserRow extends RowWithId {
    id: number
    name: string
  }

  interface PostRow extends RowWithId {
    id: number
    title: string
    userId: number
  }

  it('should throw descriptive error when filtering on joined table fields', () => {
    const usersAdapter = new MockAdapter<UserRow>()
    const postsAdapter = new MockAdapter<PostRow>()

    usersAdapter.insert({ name: 'Alice' })
    postsAdapter.insert({ title: 'Hello', userId: 1 })

    const joinQuery = new JoinQueryBuilder<UserRow>(
      usersAdapter,
      'users',
      ((tableName: string) => {
        if (tableName === 'posts') return postsAdapter
        throw new Error(`Unknown table: ${tableName}`)
      }) as any
    )

    // Filtering on 'posts.title' (a foreign field) should throw
    expect(() => {
      joinQuery
        .innerJoin('posts', 'id', 'userId')
        .where('posts.title' as any, '=', 'Hello')
        .exec()
    }).toThrow()
  })
})

// ---------------------------------------------------------------------------
// #59 - min()/max()/avg() return null for empty datasets
// ---------------------------------------------------------------------------

describe('Regression: #59 - aggregations return null for empty datasets', () => {
  interface TestRow extends RowWithId {
    id: number
    amount: number
  }

  it('min() should return null for empty dataset', () => {
    const adapter = new MockAdapter<TestRow>()
    const query = createQueryBuilder(adapter)
    expect(query.min('amount')).toBeNull()
  })

  it('max() should return null for empty dataset', () => {
    const adapter = new MockAdapter<TestRow>()
    const query = createQueryBuilder(adapter)
    expect(query.max('amount')).toBeNull()
  })

  it('avg() should return null for empty dataset', () => {
    const adapter = new MockAdapter<TestRow>()
    const query = createQueryBuilder(adapter)
    expect(query.avg('amount')).toBeNull()
  })

  it('min() should return null when filter matches nothing', () => {
    const adapter = new MockAdapter<TestRow>()
    adapter.insert({ amount: 100 })
    const query = createQueryBuilder(adapter)
    expect(query.where('amount', '>', 999).min('amount')).toBeNull()
  })

  it('max() should return null when filter matches nothing', () => {
    const adapter = new MockAdapter<TestRow>()
    adapter.insert({ amount: 100 })
    const query = createQueryBuilder(adapter)
    expect(query.where('amount', '>', 999).max('amount')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #51 - MockAdapter type ergonomics with mock: true
// ---------------------------------------------------------------------------

describe('Regression: #51 - defineSheetsDB with mock: true', () => {
  it('should create DB with mock: true without providing stores', () => {
    const db = defineSheetsDB({
      tables: {
        users: {
          columns: ['id', 'name', 'email'] as const,
          types: { id: 0, name: '', email: '' }
        }
      },
      mock: true
    })

    const user = db.from('users').create({ name: 'Test', email: 'test@test.com' })
    expect(user.id).toBe(1)
    expect(user.name).toBe('Test')
  })

  it('should throw when neither stores nor mock provided', () => {
    expect(() => {
      defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        }
      })
    }).toThrow()
  })
})
