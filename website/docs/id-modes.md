# ID Modes

gas-sheets-query supports two ID generation strategies. Choose based on your use case.

## Auto Mode (Default)

Server generates sequential numeric IDs: `1, 2, 3, ...`

```ts
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name'] as const,
      types: { id: 0, name: '' }
    }
  },
  mock: true  // idMode defaults to 'auto'
})

const user = db.from('users').create({ name: 'Alice' })
console.log(user.id) // 1

const user2 = db.from('users').create({ name: 'Bob' })
console.log(user2.id) // 2
```

### When to Use

- Simple applications with a single data source
- Google Sheets as the primary database (online-first)
- When sequential, human-readable IDs are preferred

### How It Works

- **MockAdapter**: Maintains an internal counter, auto-increments on each insert
- **SheetsAdapter**: Allocates from a persistent per-table counter stored in a hidden `_gsquery_meta` sheet inside the spreadsheet, under the GAS `LockService` script lock

Like a SQL `AUTO_INCREMENT`, the counter only moves forward: **deleting a row never frees its id for reuse**, so a foreign key pointing at a deleted record stays a visible orphan instead of silently re-binding to whatever row is inserted next. Expect gaps in the id sequence after deletions — that is by design.

The `_gsquery_meta` sheet is safe to leave alone and safe to lose: if someone deletes it, the next insert recreates it and re-bootstraps the counter from the current max id (ids still only move forward from there). The counter lives in the spreadsheet — not in script properties — so every script project that opens the spreadsheet shares one counter, and a copied spreadsheet carries its counter along.

## Client Mode

Client provides IDs at insert time (UUIDs, custom strings, etc.).

```ts
import { MockAdapter } from '@gsquery/core'

const store = new MockAdapter<User>({ idMode: 'client' })

// You must provide the ID
store.insert({ id: 'uuid-abc-123', name: 'Alice' })

// Omitting id throws an error
store.insert({ name: 'Bob' }) // Error: ID is required in client mode
```

### With defineSheetsDB

Pass `idMode` through the adapter options:

```ts
import { defineSheetsDB, MockAdapter } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name'] as const,
      types: { id: '', name: '' }  // string ID for UUIDs
    }
  },
  stores: {
    users: new MockAdapter({ idMode: 'client' })
  }
})

db.from('users').create({ id: crypto.randomUUID(), name: 'Alice' })
```

### When to Use

- Offline-first applications that sync later
- Distributed systems where multiple clients create records
- When you need UUID or custom ID formats
- When IDs must be known before insertion (e.g., for relationships)

## Comparison

| Feature | Auto | Client |
|---------|------|--------|
| ID format | Sequential numbers (`1, 2, 3`) | Any (`UUID`, custom string, etc.) |
| ID required at insert | No (generated) | Yes (must provide) |
| Concurrency | Lock-based (GAS) | Client responsibility |
| Best for | Online-first, single source | Offline-first, distributed |
| Default | Yes | No |

## Setting ID Mode per Adapter

```ts
import { MockAdapter, SheetsAdapter } from '@gsquery/core'

// MockAdapter
const mockStore = new MockAdapter({ idMode: 'client' })

// SheetsAdapter
const sheetsStore = new SheetsAdapter({
  sheetName: 'users',
  columns: ['id', 'name'],
  idMode: 'client'
})
```

---

## See Also

- [Adapters](./adapters.md) -- Full adapter configuration reference
- [CRUD Operations](./crud-operations.md) -- How create() works with each ID mode
- [Batch Operations](./batch-operations.md) -- Batch insert with ID modes
