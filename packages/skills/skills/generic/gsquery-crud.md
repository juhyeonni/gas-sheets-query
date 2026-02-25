# gsquery — CRUD & Queries

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true },
    },
  },
  mock: true, // MockAdapter for testing; omit for production
})
```

**Important**: Always use `as const` on the columns array for type inference.

Type samples: `''` → string, `0` → number, `true` → boolean, `null` → null, `new Date()` → Date.

## CRUD via TableHandle

```ts
const users = db.from('users')

// Create (omit id — auto-generated)
const user = users.create({ name: 'Alice', email: 'a@test.com', age: 30, active: true })

// Read
users.findAll()        // T[]
users.findById(1)      // T — throws RowNotFoundError if missing

// Update
users.update(1, { age: 31 })  // throws RowNotFoundError if missing

// Delete
users.delete(1)                // throws RowNotFoundError if missing

// Batch
users.batchInsert([{ name: 'Bob', email: 'b@test.com', age: 25, active: true }])
users.batchUpdate([{ id: 1, data: { active: false } }])
```

## Null-Safe Alternatives (Repository)

```ts
const repo = users.repo

repo.findByIdOrNull(999)           // T | undefined
repo.updateOrNull(999, { age: 1 }) // T | undefined
repo.deleteIfExists(999)           // boolean
repo.exists(1)                     // boolean
repo.count()                       // number
```

## Fluent Queries (QueryBuilder)

```ts
const results = db.from('users').query()
  .where('active', '=', true)
  .where('age', '>=', 18)
  .whereLike('email', '%@company.com')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

### Where Methods

| Method | Example |
|--------|---------|
| `where(field, op, value)` | `.where('age', '>=', 18)` |
| `whereEq(field, value)` | `.whereEq('active', true)` |
| `whereNot(field, value)` | `.whereNot('role', 'admin')` |
| `whereIn(field, values)` | `.whereIn('status', ['active', 'pending'])` |
| `whereLike(field, pattern)` | `.whereLike('name', 'A%')` — `%` any chars, `_` single char |

Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `in`. Multiple `.where()` = AND logic.

### Sorting & Pagination

```ts
.orderBy('name', 'asc')     // default 'asc'
.limit(10).offset(20)
.page(1, 10)                 // 1-indexed pages
```

### Execution

| Method | Returns |
|--------|---------|
| `.exec()` | `T[]` |
| `.first()` | `T \| undefined` |
| `.firstOrFail()` | `T` (throws `NoResultsError`) |
| `.count()` | `number` (ignores limit/offset) |
| `.exists()` | `boolean` |

### Single-Value Aggregation

```ts
.sum('amount')   // number (0 for empty)
.avg('amount')   // number | null
.min('amount')   // number | null
.max('amount')   // number | null
```

### Utility

```ts
.build()   // QueryOptions<T> — raw query object
.clone()   // QueryBuilder<T> — deep copy
```

## Common Mistakes

- `findById` throws on missing rows — use `repo.findByIdOrNull()` for null-safe lookups
- `columns` without `as const` loses type inference
- `page(0, 10)` is wrong — pages are 1-indexed, use `page(1, 10)`
- Multiple `.where()` is AND, not OR — use `.whereIn()` for OR-like behavior
- `.count()` ignores limit/offset — it returns total matching count
