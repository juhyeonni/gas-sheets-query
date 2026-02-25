# gsquery — Adapters & Configuration

## DataStore Interface

All adapters implement this interface:

```ts
interface DataStore<T extends RowWithId> {
  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: T | Omit<T, 'id'>): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert?(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate?(items: { id: string | number; data: Partial<T> }[]): T[]
}
```

`IdMode`: `'auto'` (adapter generates IDs) or `'client'` (caller provides IDs).

---

## MockAdapter (Testing / Node.js)

In-memory adapter with O(1) lookups.

```ts
import { MockAdapter } from '@gsquery/core'

// Simple
const store = new MockAdapter<User>([
  { id: 1, name: 'Alice', email: 'a@test.com', age: 30, active: true },
])

// With options
const store = new MockAdapter<User>({
  initialData: [...],
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['role', 'status'] },     // composite
  ],
  idMode: 'auto',
})

// Test helpers
store.reset()             // clear all data
store.reset(newData)      // replace data
store.getRawData()        // get internal array
```

Shortcut: `defineSheetsDB({ tables: {...}, mock: true })` auto-creates MockAdapter for all tables.

---

## SheetsAdapter (Production / GAS)

Reads/writes Google Sheets. Works only in GAS runtime.

```ts
import { SheetsAdapter } from '@gsquery/core'

const store = new SheetsAdapter<User>({
  spreadsheetId: 'abc123',         // omit for active spreadsheet
  sheetName: 'Users',              // required
  columns: ['id', 'name', 'email', 'age', 'active'],  // required
  createIfNotExists: true,         // default: true
  idColumn: 'id',                  // default: 'id'
  idMode: 'auto',                  // default: 'auto'
  columnTypes: {                   // optional type serialization
    age: 'number',
    active: 'boolean',
    tags: 'string[]',
    metadata: 'json',
  },
})
```

### Column Types

`'string'` | `'number'` | `'boolean'` | `'date'` | `'string[]'` | `'number[]'` | `'object'` | `'json'`

Features: data caching (auto-invalidates on writes), LockService for concurrent ID generation, automatic JSON serialization.

```ts
store.clearCache()    // force re-read
store.reset(data?)    // clear and re-populate
```

---

## Indexing

```ts
import { IndexStore } from '@gsquery/core'

// Usually configured via MockAdapter options:
const store = new MockAdapter<User>({
  indexes: [{ fields: ['email'], unique: true }],
})
// Equality queries on indexed fields use O(1) lookups
```

---

## Providing Custom Stores

```ts
const db = defineSheetsDB({
  tables: {
    users: { columns: ['id', 'name', 'email'] as const, types: { id: 0, name: '', email: '' } },
  },
  stores: {
    users: new SheetsAdapter({
      sheetName: 'Users',
      columns: ['id', 'name', 'email'],
    }),
  },
})
```

## Common Mistakes

- SheetsAdapter only works in GAS — use MockAdapter for Node.js/testing
- First column should be `'id'` (or set `idColumn`)
- Index field names are case-sensitive
- `columnTypes` keys must match actual column names
