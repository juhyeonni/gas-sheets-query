---
skill: gsquery
version: 0.9.0
triggers:
  - "Google Sheets database"
  - "gas-sheets-query"
  - "gsquery"
  - "Sheets as database"
  - "GAS spreadsheet"
references:
  - references/crud-and-queries.md
  - references/joins-and-aggregation.md
  - references/adapters-and-config.md
  - references/migration-and-cli.md
  - references/errors-and-viz.md
---

# gsquery — Google Sheets as a Database

TypeScript library for using Google Sheets as a typed database in Google Apps Script projects.

## Packages

| Package | Purpose |
|---------|---------|
| `@gsquery/core` | Repository, QueryBuilder, Adapters, Migrations, Viz API |
| `@gsquery/client` | Typed client factory with environment auto-detection |
| `@gsquery/cli` | Schema parsing, type generation, migration CLI |

## Quick Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true },
    },
    posts: {
      columns: ['id', 'title', 'body', 'authorId', 'published'] as const,
      types: { id: 0, title: '', body: '', authorId: 0, published: false },
    },
  },
  mock: true, // use MockAdapter for testing; omit for SheetsAdapter
})
```

## CRUD (via TableHandle)

```ts
const users = db.from('users')

// Create
const user = users.create({ name: 'Alice', email: 'a@test.com', age: 30, active: true })

// Read
const all = users.findAll()
const one = users.findById(1) // throws RowNotFoundError if missing

// Update
users.update(1, { age: 31 }) // throws RowNotFoundError if missing

// Delete
users.delete(1) // throws RowNotFoundError if missing

// Batch
users.batchInsert([{ name: 'Bob', email: 'b@test.com', age: 25, active: true }])
users.batchUpdate([{ id: 2, data: { active: false } }])
```

## Query Operators

| Method | Example |
|--------|---------|
| `where(field, op, value)` | `.where('age', '>=', 18)` |
| `whereEq(field, value)` | `.whereEq('active', true)` |
| `whereNot(field, value)` | `.whereNot('role', 'admin')` |
| `whereIn(field, values)` | `.whereIn('status', ['active', 'pending'])` |
| `whereLike(field, pattern)` | `.whereLike('name', 'A%')` |
| `orderBy(field, dir?)` | `.orderBy('name', 'asc')` |
| `limit(n)` / `offset(n)` | `.limit(10).offset(20)` |
| `page(num, size)` | `.page(1, 10)` — 1-indexed |

### Execution

| Method | Returns |
|--------|---------|
| `.exec()` | `T[]` |
| `.first()` | `T \| undefined` |
| `.firstOrFail()` | `T` (throws `NoResultsError`) |
| `.count()` | `number` (ignores limit/offset) |
| `.exists()` | `boolean` |

### Aggregation (single-value)

| Method | Returns |
|--------|---------|
| `.sum('field')` | `number` (0 for empty) |
| `.avg('field')` | `number \| null` |
| `.min('field')` | `number \| null` |
| `.max('field')` | `number \| null` |

## Anti-Patterns

```ts
// WRONG: findById returns the row, not undefined — it throws on missing
const user = users.findById(999) // throws RowNotFoundError
if (!user) { /* never reached */ }

// RIGHT: use Repository directly for null-safe lookup
const user = users.repo.findByIdOrNull(999)
if (!user) { /* handle missing */ }

// WRONG: columns without `as const` — loses type inference
const db = defineSheetsDB({ tables: { t: { columns: ['id', 'name'] } } })

// RIGHT: always use `as const`
const db = defineSheetsDB({ tables: { t: { columns: ['id', 'name'] as const } } })

// WRONG: passing full row with id to create()
users.create({ id: 1, name: 'Alice', email: 'a@test.com', age: 30, active: true })

// RIGHT: omit id (auto-generated) unless idMode is 'client'
users.create({ name: 'Alice', email: 'a@test.com', age: 30, active: true })

// WRONG: page(0, 10) — pages are 1-indexed
users.query().page(0, 10).exec()

// RIGHT:
users.query().page(1, 10).exec()
```

## References

- **CRUD & Queries**: `references/crud-and-queries.md` — Full Repository, QueryBuilder API
- **Joins & Aggregation**: `references/joins-and-aggregation.md` — JoinQueryBuilder, groupBy, agg
- **Adapters & Config**: `references/adapters-and-config.md` — DataStore, MockAdapter, SheetsAdapter, Indexes
- **Migration & CLI**: `references/migration-and-cli.md` — MigrationRunner, SchemaBuilder, CLI commands
- **Errors & Viz**: `references/errors-and-viz.md` — Error hierarchy, Visualization API
