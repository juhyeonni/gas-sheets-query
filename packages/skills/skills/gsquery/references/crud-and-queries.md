# CRUD & Queries Reference

## defineSheetsDB (Recommended Entry Point)

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true },
    },
  },
  // Option A: auto-create MockAdapter for all tables (testing)
  mock: true,
  // Option B: provide custom stores
  // stores: { users: new SheetsAdapter({ sheetName: 'Users', columns: ['id', 'name', 'email', 'age', 'active'] }) },
  // Option C: set spreadsheetId (used by SheetsAdapter)
  // spreadsheetId: 'your-spreadsheet-id',
})
```

**Type inference**: `columns: [...] as const` + `types: { field: sampleValue }` infers row types automatically. Sample values: `''` → string, `0` → number, `true` → boolean, `null` → null, `new Date()` → Date.

## createSheetsDB (Legacy API)

```ts
import { createSheetsDB } from '@gsquery/core'

interface User { id: number; name: string; email: string }

const db = createSheetsDB<{ users: User }>({
  config: {
    tables: {
      users: { columns: ['id', 'name', 'email'] },
    },
  },
  stores: {
    users: new MockAdapter<User>(),
  },
})
```

## SheetsDB Interface

```ts
interface SheetsDB<Tables> {
  from<K extends keyof Tables>(tableName: K): TableHandle<Tables[K]>
  getStore<K extends keyof Tables>(tableName: K): DataStore<Tables[K]>
  readonly config: SheetsDBConfig
}
```

## TableHandle — CRUD API

```ts
const users = db.from('users')

// Create — returns created row with auto-generated id
users.create({ name: 'Alice', email: 'a@test.com', age: 30, active: true })
// Also accepts full row with id: users.create({ id: 1, name: ... })

// Read
users.findAll()          // T[]
users.findById(1)        // T — throws RowNotFoundError if missing

// Update — returns updated row
users.update(1, { age: 31 })  // throws RowNotFoundError if missing

// Delete
users.delete(1)          // throws RowNotFoundError if missing

// Batch operations
users.batchInsert([
  { name: 'Bob', email: 'b@test.com', age: 25, active: true },
  { name: 'Carol', email: 'c@test.com', age: 28, active: false },
])
users.batchUpdate([
  { id: 1, data: { active: false } },
  { id: 2, data: { age: 26 } },
])

// Access underlying Repository and QueryBuilder
users.repo             // Repository<T>
users.query()          // QueryBuilder<T>
users.joinQuery()      // JoinQueryBuilder<T>
```

## Repository — Extended CRUD

```ts
const repo = users.repo

repo.findAll()                  // T[]
repo.find(queryOptions)         // T[] — with QueryOptions
repo.findById(1)                // T — throws RowNotFoundError
repo.findByIdOrNull(1)          // T | undefined — null-safe
repo.create({ ... })            // T
repo.update(1, { ... })         // T — throws RowNotFoundError
repo.updateOrNull(1, { ... })   // T | undefined — null-safe
repo.delete(1)                  // void — throws RowNotFoundError
repo.deleteIfExists(1)          // boolean — returns false if missing
repo.count()                    // number
repo.exists(1)                  // boolean
repo.batchInsert([...])         // T[]
repo.batchUpdate([...])         // T[]
```

## QueryBuilder — Fluent Queries

```ts
const results = db.from('users').query()
  .where('active', '=', true)
  .where('age', '>=', 18)
  .whereLike('email', '%@company.com')
  .orderBy('name', 'asc')
  .limit(10)
  .offset(0)
  .exec()
```

### Where Methods

```ts
.where(field, operator, value)    // operators: = != > >= < <= like in
.where(field, 'in', values[])     // array membership
.whereEq(field, value)            // shorthand for =
.whereNot(field, value)           // shorthand for !=
.whereIn(field, values[])         // shorthand for in
.whereLike(field, pattern)        // % = any chars, _ = single char (case-insensitive)
```

Multiple `.where()` calls use AND logic.

### Sorting & Pagination

```ts
.orderBy(field, 'asc' | 'desc')  // default 'asc'; multiple orderBy calls chain
.limit(count)
.offset(count)
.page(pageNumber, pageSize)       // 1-indexed; page(1, 10) = first 10 rows
```

### Execution Methods

```ts
.exec()          // T[] — apply all filters, sort, pagination
.first()         // T | undefined — first matching row
.firstOrFail()   // T — throws NoResultsError if empty
.count()         // number — ignores limit/offset
.exists()        // boolean — true if any match
```

### Single-Value Aggregation

```ts
.sum(field)      // number — returns 0 for empty result set
.avg(field)      // number | null — returns null for empty
.min(field)      // number | null — returns null for empty
.max(field)      // number | null — returns null for empty
```

These ignore limit/offset.

### Utility Methods

```ts
.build()         // QueryOptions<T> — returns the raw query options
.clone()         // QueryBuilder<T> — deep copy for reuse
```

### QueryOptions Type

```ts
interface QueryOptions<T> {
  where: WhereCondition<T>[]
  orderBy: OrderByCondition<T>[]
  limitValue?: number
  offsetValue?: number
}

interface WhereCondition<T> {
  field: keyof T & string
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in'
  value: unknown
}

interface OrderByCondition<T> {
  field: keyof T & string
  direction: 'asc' | 'desc'
}
```

## Anti-Patterns

```ts
// WRONG: where() with wrong operator type for 'in'
.where('status', 'in', 'active')           // value must be an array
// RIGHT:
.where('status', 'in', ['active', 'pending'])

// WRONG: chaining where() for OR logic — multiple where() is always AND
.where('role', '=', 'admin').where('role', '=', 'editor')  // matches nothing
// RIGHT: use whereIn for OR-like behavior
.whereIn('role', ['admin', 'editor'])

// WRONG: expecting count() to respect limit
.where('active', '=', true).limit(5).count()  // returns total count, not 5
```
