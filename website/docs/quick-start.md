# Quick Start

Get up and running in 60 seconds.

## 1. Install

```bash
pnpm add @gsquery/core
```

## 2. Define Your Database

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true }
    },
    posts: {
      columns: ['id', 'title', 'body', 'userId', 'published'] as const,
      types: { id: 0, title: '', body: '', userId: 0, published: false }
    }
  },
  mock: true  // in-memory for development & testing
})
```

## 3. Create Records

```ts
const users = db.from('users')

const alice = users.create({ name: 'Alice', email: 'alice@example.com', age: 30, active: true })
const bob   = users.create({ name: 'Bob',   email: 'bob@example.com',   age: 25, active: true })

console.log(alice) // { id: 1, name: 'Alice', email: 'alice@example.com', age: 30, active: true }
```

## 4. Query Data

```ts
// Find all active users over 18, sorted by name
const results = users.query()
  .where('active', '=', true)
  .where('age', '>', 18)
  .orderBy('name', 'asc')
  .exec()

// Get a single user
const user = users.findById(1) // { id: 1, name: 'Alice', ... }
```

## 5. Update & Delete

```ts
// Update
users.update(1, { age: 31 })

// Delete
users.delete(2)
```

## 6. Connect to Google Sheets (Production)

Replace `mock: true` with a `SheetsAdapter` to connect to real Google Sheets. Name the table schema as a `const` and hand its inferred row type to the adapter with `InferRowFromSchema` — an untyped `new SheetsAdapter({...})` defaults to `SheetsAdapter<RowWithId>` and will not typecheck against the inferred store type:

```ts
import { defineSheetsDB, SheetsAdapter } from '@gsquery/core'
import type { InferRowFromSchema } from '@gsquery/core'

const users = {
  columns: ['id', 'name', 'email', 'age', 'active'] as const,
  types: { id: 0, name: '', email: '', age: 0, active: true }
}

const db = defineSheetsDB({
  tables: { users },
  stores: {
    users: new SheetsAdapter<InferRowFromSchema<typeof users>>({
      sheetName: 'users',
      columns: [...users.columns]
    })
  }
})
```

The query API is identical -- no code changes required.

---

## Next Steps

- [CRUD Operations](./crud-operations.md) -- Full CRUD reference
- [Query Builder](./query-builder.md) -- Advanced filtering, sorting, pagination
- [Schema Definition](./schema-definition.md) -- YAML schema format for code generation
- [Adapters](./adapters.md) -- MockAdapter vs SheetsAdapter in detail

---

## See Also

- [Installation](./installation.md) -- Detailed install options
- [Architecture Overview](./architecture-overview.md) -- How the layers work together
