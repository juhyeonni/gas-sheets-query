# Adapters

Adapters implement the `DataStore` interface and provide the storage backend for gas-sheets-query. Swap adapters without changing your application code.

## DataStore Interface

Every adapter implements this interface:

```ts
interface DataStore<T extends RowWithId> {
  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: T | Omit<T, 'id'>): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert?(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate?(items: BatchUpdateItem<T>[]): T[]
  batchDelete?(ids: (string | number)[]): number
  count?(): number
}
```

## MockAdapter

In-memory storage for testing and development. No external dependencies.

### Basic Usage

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' }
    }
  },
  mock: true  // auto-creates MockAdapter for each table
})
```

### With Initial Data

```ts
import { MockAdapter } from '@gsquery/core'

type User = { id: number; name: string; email: string }

const store = new MockAdapter<User>([
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' }
])
```

### With Options

```ts
const store = new MockAdapter<User>({
  initialData: [
    { id: 1, name: 'Alice', email: 'alice@example.com' }
  ],
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['name'] }
  ],
  idMode: 'auto' // or 'client'
})
```

### Test Helpers

```ts
// Reset all data
store.reset()

// Reset with new seed data
store.reset([
  { id: 1, name: 'Test', email: 'test@example.com' }
])

// Get raw internal data
const raw = store.getRawData()
```

### Features

- O(1) ID lookups via internal Map index
- Column indexing support for query optimization
- Supports both `auto` and `client` ID modes
- Batch operations (batchInsert, batchUpdate, batchDelete)

## SheetsAdapter

Connects to a real Google Sheet. Runs in the Google Apps Script environment.

### Basic Usage

```ts
import { SheetsAdapter } from '@gsquery/core'

const store = new SheetsAdapter<User>({
  sheetName: 'users',
  columns: ['id', 'name', 'email', 'age', 'active']
})
```

### With Options

```ts
const store = new SheetsAdapter<User>({
  spreadsheetId: 'abc123...',     // optional, uses active spreadsheet if omitted
  sheetName: 'users',
  columns: ['id', 'name', 'email', 'age', 'active'],
  idColumn: 'id',                  // default: 'id'
  createIfNotExists: true,         // default: true, auto-creates sheet with headers
  idMode: 'auto',                  // default: 'auto'
  columnTypes: {                   // optional: explicit type serialization
    tags: 'string[]',
    metadata: 'json'
  },
  allowFormulas: false,            // default: false, see Formula Safety below
  skipHeaderCheck: false,          // default: false, see Header Drift below
  patchCacheOnWrite: false         // default: false, see Caching below
})
```

### Header Drift

`SheetsAdapter` is **positional**: cell 1 is `columns[0]`, cell 2 is `columns[1]`,
and so on. If somebody opens the sheet and inserts a column in the middle, every
value to its right shifts one place — reads then return the neighbouring
column's values, and a write overwrites the inserted column while leaving the
real one stale.

Every read and write therefore verifies once per execution that the physical
header row still matches `columns`, and throws
[`SchemaMismatchError`](./error-handling.md) (`code: 'SCHEMA_MISMATCH'`) naming
the first column that diverged:

```
Sheet "users" header [id, owner, name] does not match the declared columns
[id, name, score]. Header column 2 (B) expected "name" but found "owner", ...
```

The check is a single 1×N read of row 1, shared by every operation in the
execution, and it deliberately tolerates the two layouts that are *not*
misaligned:

- a header that is a **prefix** of `columns` (a sheet not yet migrated by
  `addColumn`);
- extra physical columns to the **right** of the schema, which are never read
  and never written.

`getRawData()` is not guarded — use it to inspect a sheet the guard rejected.

> **If this started firing right after a migration**: a value-level
> `renameColumn` moves cell values but never rewrites the header, so the sheet
> can be left with the old name (`name`) under a schema that declares the new
> one (`displayName`). The guard is right to flag it — rename the header cell to
> match the schema (see issue #180 for making `renameColumn` physical).

Set `skipHeaderCheck: true` only for sheets whose header row is deliberately not
the column list (a decorative or localized title row, or a header your script
does not own). It restores the old behavior: misalignment becomes silent again,
and keeping the physical layout in the declared order is entirely on you.

### Formula Safety

Strings that start with `=`, `+`, `-`, `@`, a tab or a carriage return would be
parsed by Sheets as formulas, so `SheetsAdapter` writes them as literal text and
returns the original string on read. Set `allowFormulas: true` only when the
values come from your own script and are meant to run as formulas — never for
user input.

### Column Types

The `columnTypes` option enables type-aware serialization for complex data:

| Type | Sheet Storage | TypeScript |
|------|---------------|------------|
| `'string'` | Plain text | `string` |
| `'number'` | Number | `number` |
| `'boolean'` | `TRUE`/`FALSE` | `boolean` |
| `'date'` | ISO string | `Date` |
| `'string[]'` | JSON array | `string[]` |
| `'number[]'` | JSON array | `number[]` |
| `'object'` | JSON | `object` |
| `'json'` | JSON | `unknown` |

### Caching

SheetsAdapter uses internal caching for performance:

```ts
// find/findAll (and query/JOIN/aggregation) are served from the cache after the first read
store.findAll() // reads from sheet
store.findAll() // returns cached copy

// findById is served from the same cache when it is warm (no sheet read)
store.findById(1)

// Any write drops the cache
store.insert(data) // cache cleared
store.findAll()    // reads from sheet again

// Manually clear all caches (sheet refs + data)
store.clearCache()
```

With `patchCacheOnWrite: true`, row writes patch a warm cache with what they
wrote instead of dropping it, so an insert + `findAll` loop reads the table once.
Rows written by other executions then appear only after `clearCache()` or in a
new execution, and a value Sheets may coerce (such as a string containing a
digit) still drops the cache. See
[Patching the cache on write](./operations.md#patching-the-cache-on-write-patchcacheonwrite).

See [Operations](./operations.md) for the real read and write costs per operation.

### Concurrency

In `auto` ID mode, `SheetsAdapter` uses GAS `LockService` to safely generate sequential IDs when multiple users write simultaneously.

## Custom Adapters

Implement the `DataStore` interface to create your own adapter:

```ts
import type { DataStore, RowWithId, QueryOptions } from '@gsquery/core'

class MyCustomAdapter<T extends RowWithId> implements DataStore<T> {
  findAll(): T[] { /* ... */ }
  find(options: QueryOptions<T>): T[] { /* ... */ }
  findById(id: string | number): T | undefined { /* ... */ }
  insert(data: T | Omit<T, 'id'>): T { /* ... */ }
  update(id: string | number, data: Partial<T>): T | undefined { /* ... */ }
  delete(id: string | number): boolean { /* ... */ }
}
```

Then pass it via `stores`:

```ts
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' }
    }
  },
  stores: {
    users: new MyCustomAdapter()
  }
})
```

---

## See Also

- [ID Modes](./id-modes.md) -- Auto vs Client ID generation
- [Indexing and Performance](./indexing-and-performance.md) -- Column indexes in MockAdapter
- [Architecture Overview](./architecture-overview.md) -- How adapters fit into the system
