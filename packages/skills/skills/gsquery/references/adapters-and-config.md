# Adapters & Config Reference

## DataStore Interface

All adapters implement this interface. Use it to create custom adapters.

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
}

interface BatchUpdateItem<T> {
  id: string | number
  data: Partial<T>
}

type IdMode = 'auto' | 'client'
```

- `'auto'`: adapter generates IDs (default)
- `'client'`: caller provides IDs in data

---

## MockAdapter (Testing)

In-memory adapter with O(1) ID lookups via Map, optional column indexing.

```ts
import { MockAdapter } from '@gsquery/core'

// Simple: from array
const store = new MockAdapter<User>([
  { id: 1, name: 'Alice', email: 'a@test.com', age: 30, active: true },
])

// With options
const store = new MockAdapter<User>({
  initialData: [{ id: 1, name: 'Alice', email: 'a@test.com', age: 30, active: true }],
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['role', 'status'] },  // composite index
  ],
  idMode: 'auto',  // or 'client'
})
```

### MockAdapter Options

```ts
interface MockAdapterOptions<T> {
  initialData?: T[]
  indexes?: IndexDefinition[]
  idMode?: IdMode
}

interface IndexDefinition {
  fields: string[]    // field names (order matters for composite)
  unique?: boolean    // enforce uniqueness
}
```

### Test Helpers

```ts
store.reset()            // clear all data
store.reset(newData)     // replace with new data
store.getRawData()       // get internal array
```

### Using mock in defineSheetsDB

```ts
// Simplest: auto-creates MockAdapter for all tables
const db = defineSheetsDB({ tables: { ... }, mock: true })
```

---

## SheetsAdapter (Production — GAS)

Reads/writes Google Sheets via `SpreadsheetApp`. Works only in GAS runtime.

```ts
import { SheetsAdapter } from '@gsquery/core'

const store = new SheetsAdapter<User>({
  spreadsheetId: 'abc123',          // omit to use SpreadsheetApp.getActiveSpreadsheet()
  sheetName: 'Users',               // required — name of the sheet tab
  columns: ['id', 'name', 'email', 'age', 'active'],  // required — column order
  createIfNotExists: true,          // default: true — creates sheet if missing
  idColumn: 'id',                   // default: 'id'
  idMode: 'auto',                   // default: 'auto'
  columnTypes: {                    // optional — type-aware serialization
    age: 'number',
    active: 'boolean',
    tags: 'string[]',
    metadata: 'json',
  },
})
```

### SheetsAdapter Options

```ts
interface SheetsAdapterOptions {
  spreadsheetId?: string
  sheetName: string
  columns: string[]
  createIfNotExists?: boolean
  idColumn?: string
  idMode?: IdMode
  columnTypes?: Record<string, ColumnType>
}

type ColumnType =
  | 'string'    // default
  | 'number'
  | 'boolean'
  | 'date'
  | 'string[]'  // JSON array
  | 'number[]'  // JSON array
  | 'object'    // JSON object
  | 'json'      // any JSON
```

### Features

- **Data caching**: Reads sheet once, auto-invalidates on writes
- **LockService**: Concurrent-safe auto-increment ID generation
- **Column types**: Automatic serialization/deserialization (JSON for arrays/objects, booleans, dates)
- **Auto-detect JSON**: Parses JSON strings in cells automatically

### Sheets-Specific Methods

```ts
store.clearCache()       // force re-read from sheet
store.reset(data?)       // clear and optionally re-populate
store.getRawData()       // get raw 2D array from sheet
```

---

## IndexStore (Column Indexing)

Provides O(1) equality lookups on indexed fields. Used internally by MockAdapter.

```ts
import { IndexStore } from '@gsquery/core'

const indexStore = new IndexStore<User>([
  { fields: ['email'], unique: true },
  { fields: ['role', 'status'] },
])

// Build indexes from data
indexStore.rebuild(allData)

// O(1) lookup
const rowIndices = indexStore.lookup(['email'], ['alice@test.com'])
// Returns Set<number> of matching row indices, or undefined if no index
```

### When to Use

- Equality queries on frequently queried fields
- Unique constraints (e.g., email)
- Composite indexes for multi-field lookups

---

## Providing Custom Stores

```ts
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' },
    },
  },
  stores: {
    users: new SheetsAdapter({
      sheetName: 'Users',
      columns: ['id', 'name', 'email'],
      columnTypes: { name: 'string', email: 'string' },
    }),
  },
})
```

## Anti-Patterns

```ts
// WRONG: using SheetsAdapter outside GAS runtime — SpreadsheetApp is GAS-only
const store = new SheetsAdapter({ sheetName: 'Test', columns: ['id'] })  // Error in Node.js

// RIGHT: use MockAdapter for Node.js testing
const store = new MockAdapter<User>()

// WRONG: columns array doesn't include 'id'
new SheetsAdapter({ sheetName: 'T', columns: ['name', 'email'] })
// RIGHT: first column should be 'id' (or set idColumn)
new SheetsAdapter({ sheetName: 'T', columns: ['id', 'name', 'email'] })

// WRONG: index fields not matching actual field names
new MockAdapter({ indexes: [{ fields: ['Email'] }] })  // case-sensitive
// RIGHT:
new MockAdapter({ indexes: [{ fields: ['email'] }] })
```
