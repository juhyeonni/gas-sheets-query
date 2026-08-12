# Batch Operations

Batch operations insert or update multiple rows in a single call. More efficient than looping over individual operations.

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age'] as const,
      types: { id: 0, name: '', email: '', age: 0 }
    }
  },
  mock: true
})

const users = db.from('users')
```

## Batch Insert

Insert multiple rows at once:

```ts
const newUsers = users.batchInsert([
  { name: 'Alice', email: 'alice@example.com', age: 30 },
  { name: 'Bob',   email: 'bob@example.com',   age: 25 },
  { name: 'Carol', email: 'carol@example.com', age: 35 }
])

// [
//   { id: 1, name: 'Alice', ... },
//   { id: 2, name: 'Bob',   ... },
//   { id: 3, name: 'Carol', ... }
// ]
```

### Performance Benefit

- **MockAdapter**: Single iteration, builds index entries in batch
- **SheetsAdapter**: Single `setValues()` call instead of multiple `appendRow()` calls, reducing API call overhead

## Batch Update

Update multiple rows at once by providing ID and update data:

```ts
const updated = users.batchUpdate([
  { id: 1, data: { age: 31 } },
  { id: 2, data: { age: 26, email: 'bob.new@example.com' } },
  { id: 3, data: { name: 'Caroline' } }
])

// Returns array of updated rows
// Rows that don't exist are silently skipped (no error)
```

### Behavior

- Returns only successfully updated rows
- Skips IDs that don't exist (no error thrown)
- Each update is a partial update (only specified fields change)

## Batch Insert with Client IDs

When using `client` ID mode, you must provide IDs:

```ts
import { MockAdapter } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    items: {
      columns: ['id', 'name'] as const,
      types: { id: '', name: '' }
    }
  },
  stores: {
    items: new MockAdapter({ idMode: 'client' })
  }
})

db.from('items').batchInsert([
  { id: 'uuid-1', name: 'Item A' },
  { id: 'uuid-2', name: 'Item B' }
])
```

## Via Repository

Batch operations are also available on the `Repository` directly:

```ts
const repo = db.from('users').repo

repo.batchInsert([...])
repo.batchUpdate([...])
```

## Fallback Behavior

If an adapter doesn't implement the optional `batchInsert` or `batchUpdate` methods, the Repository falls back to sequential individual operations automatically.

---

## See Also

- [CRUD Operations](./crud-operations.md) -- Single-row create, update, delete
- [Adapters](./adapters.md) -- How batch operations work in each adapter
- [ID Modes](./id-modes.md) -- Auto vs Client ID generation
