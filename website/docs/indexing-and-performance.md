# Indexing and Performance

gas-sheets-query supports column indexing for query optimization in the `MockAdapter`.

## IndexStore

The `IndexStore` manages column indexes for a single table. It maintains a mapping from field values to row indices for O(1) lookups.

### Defining Indexes

```ts
import { MockAdapter } from '@gsquery/core'

type User = { id: number; name: string; email: string; status: string; role: string }

const store = new MockAdapter<User>({
  initialData: [...],
  indexes: [
    { fields: ['status'] },                  // single-column index
    { fields: ['email'], unique: true },     // unique index
    { fields: ['role', 'status'] }           // composite index
  ]
})
```

### Index Types

| Type | Definition | Lookup |
|------|-----------|--------|
| Single column | `{ fields: ['status'] }` | Equality on `status` |
| Unique | `{ fields: ['email'], unique: true }` | Unique constraint on `email` |
| Composite | `{ fields: ['role', 'status'] }` | Equality on both `role` AND `status` |

## How Indexes Work

### Without Index (Full Scan)

```
Query: where('status', '=', 'active')
→ Scans all N rows, checks each → O(N)
```

### With Index

```
Query: where('status', '=', 'active')
→ Index lookup: status='active' → Set{0, 3, 7} → O(1)
→ Only fetch those 3 rows
```

### Index Data Structure

```
Single index on 'status':
  "status" → Map {
    '["active"]' → Set{0, 3, 7},
    '["inactive"]' → Set{1, 4},
    '["pending"]' → Set{2, 5, 6}
  }

Composite index on ['role', 'status']:
  "role|status" → Map {
    '["admin","active"]' → Set{0, 3},
    '["user","active"]' → Set{7},
    '["admin","inactive"]' → Set{1}
  }
```

## Index Utilization in Queries

The `MockAdapter.find()` method automatically uses available indexes:

1. Extract equality conditions from the query
2. Try single-field index lookups
3. Try compound index lookups (if 2+ equality conditions)
4. Intersect index results (AND logic)
5. Apply remaining non-indexed conditions on the candidate set

```ts
// This query uses the 'status' index
store.find({
  where: [{ field: 'status', operator: '=', value: 'active' }],
  orderBy: []
})

// This query uses the composite ['role', 'status'] index
store.find({
  where: [
    { field: 'role', operator: '=', value: 'admin' },
    { field: 'status', operator: '=', value: 'active' }
  ],
  orderBy: []
})
```

> **Note:** Only `=` (equality) conditions can use indexes. Conditions with `>`, `<`, `like`, `in`, etc. always require a scan on the candidate set.

## Using IndexStore Directly

```ts
import { IndexStore } from '@gsquery/core'

const indexStore = new IndexStore<User>([
  { fields: ['status'] },
  { fields: ['role', 'status'] }
])

// Build indexes from data
indexStore.rebuild(users)

// Lookup
const indices = indexStore.lookup(['status'], ['active'])
// Set{0, 3, 7} or undefined if no index

// Check if index exists
indexStore.hasIndex(['status'])          // true
indexStore.hasIndex(['nonexistent'])     // false

// Prefix matching for composite indexes
indexStore.findIndexByPrefix(['role'])   // finds ['role', 'status'] index
```

## Index Maintenance

Indexes are automatically maintained on data changes:

| Operation | Index Update |
|-----------|-------------|
| `insert()` | `addToIndex()` |
| `update()` | `updateIndex()` (old value removed, new value added) |
| `delete()` | `removeFromIndex()` + `reindexAfterDelete()` |
| `batchInsert()` | `addToIndex()` for each row |
| `batchUpdate()` | `updateIndex()` for each row |
| `reset()` | Full `rebuild()` |

## Performance Tips

### 1. Index Frequently Filtered Columns

```ts
// If you often filter by 'status', add an index
indexes: [{ fields: ['status'] }]
```

### 2. Use Composite Indexes for Multi-Field Queries

```ts
// If you often filter by both 'role' AND 'status' together
indexes: [{ fields: ['role', 'status'] }]
```

### 3. Batch Operations

Use `batchInsert` and `batchUpdate` instead of loops:

```ts
// Good: single batch call
users.batchInsert(rows)

// Avoid: individual inserts in loop
for (const row of rows) {
  users.insert(row)
}
```

### 4. SheetsAdapter Caching

`SheetsAdapter` caches `findAll()` results. The cache is invalidated on writes:

```ts
store.findAll()  // reads from sheet
store.findAll()  // returns cache

store.insert(x)  // cache invalidated
store.findAll()  // reads from sheet again

store.clearCache()  // manual cache clear
```

---

## See Also

- [Adapters](./adapters.md) -- MockAdapter and SheetsAdapter details
- [Query Builder](./query-builder.md) -- How queries use indexes
