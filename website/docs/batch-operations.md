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
- **SheetsAdapter**: Single ranged `setValues()` call; in auto mode the id column is read at most once per adapter instance (the `_meta` counter is read and advanced on every batch); in client mode the existing id keys are read once per batch, not per row.

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

### Performance

On SheetsAdapter, `batchUpdate` reads the id column, then only the rows from the first to the last matched one (`N + span*C` cells), then writes one `setValues()` per contiguous run of updated rows — a contiguous block is one write, scattered rows cost one write each.

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

## Batch Delete

Delete multiple rows by id at once:

```ts
const deleted = users.batchDelete([1, 2, 3, 99])
// Returns the number of rows deleted (3 here)
// Missing and duplicate ids are skipped (no error thrown)
```

On SheetsAdapter, `batchDelete` takes the script lock once, reads the id column
once, and issues one `deleteRows` per contiguous run of rows, highest run first,
so scattered ids cost one call per run instead of one `deleteRow` per id. Each
run is attempted exactly once: if a run fails, the error is thrown, the runs
already deleted stay deleted, and nothing is retried.

## Via Repository

Batch operations are also available on the `Repository` directly:

```ts
const repo = db.from('users').repo

repo.batchInsert([...])
repo.batchUpdate([...])
repo.batchDelete([...])
```

## Fallback Behavior

If an adapter doesn't implement the optional `batchInsert`, `batchUpdate` or `batchDelete` methods, the Repository falls back to sequential individual operations automatically (`batchDelete` counts the `delete` calls that removed a row).

## Jobs Longer Than One Execution

Each batch call is all-or-nothing and runs in one execution. For a job that may
not finish inside Apps Script's 6-minute limit, wrap the batch call in
`runChunked`: it writes in chunks, stops before the deadline and returns a
cursor to resume from. See
[Operations: Long Jobs](./operations.md#long-jobs-and-the-6-minute-ceiling).

---

## See Also

- [CRUD Operations](./crud-operations.md) -- Single-row create, update, delete
- [Adapters](./adapters.md) -- How batch operations work in each adapter
- [ID Modes](./id-modes.md) -- Auto vs Client ID generation
