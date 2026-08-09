# Migration System

Version-controlled schema changes with `up` and `down` migrations.

## Overview

Migrations let you evolve your database schema over time. Each migration has a version number, a name, an `up` function (apply), and a `down` function (revert).

## Defining Migrations

```ts
import type { Migration } from '@gsquery/core'

const migrations: Migration[] = [
  {
    version: 1,
    name: 'add-user-role',
    up: (db) => {
      db.addColumn('users', 'role', { default: 'viewer', type: 'string' })
    },
    down: (db) => {
      db.removeColumn('users', 'role')
    }
  },
  {
    version: 2,
    name: 'rename-email-to-emailAddress',
    up: (db) => {
      db.renameColumn('users', 'email', 'emailAddress')
    },
    down: (db) => {
      db.renameColumn('users', 'emailAddress', 'email')
    }
  }
]
```

## SchemaBuilder Operations

The `SchemaBuilder` passed to `up`/`down` supports:

| Method | Description |
|--------|-------------|
| `addColumn(table, column, options?)` | Add a new column to a table |
| `removeColumn(table, column)` | Remove a column from a table |
| `renameColumn(table, oldName, newName)` | Rename a column |

### Column Options

```ts
interface ColumnOptions<T = unknown> {
  default?: T          // Default value for existing rows
  type?: 'string' | 'number' | 'boolean' | 'date'  // Type hint
}
```

### How `addColumn` is applied

`SheetsAdapter` maps cells to fields **by position**, so the column has to be part
of the store's declared `columns` before it can hold anything:

- **Declared in `columns`, missing from the sheet** — the migration writes the
  header (inserting the physical column at its schema position when it is not the
  last one) and, if a `default` is given, backfills every empty cell in that
  column with **one ranged write**. Cost does not grow with the row count.
- **Not declared in `columns`** — the migration throws `UnknownColumnError`
  (wrapped in `MigrationExecutionError`). Nothing is written and the schema
  version does not advance, instead of reporting a success that never reached the
  sheet. Add the column to your schema (or regenerate your types) and re-run.
- **Sheet header contradicts the schema** — `SchemaMismatchError`, for the same
  reason: writing into a misaligned sheet would corrupt data.

Without a `default`, no row values are written at all, so re-running a migration
is a no-op rather than a full rewrite of the table. In-memory stores
(`MockAdapter`, `@gsquery/client`'s `LocalAdapter`) are keyed by name, not by
position: they accept any column, and the backfill goes through a single
`batchUpdate`.

### How `renameColumn` is applied

On `SheetsAdapter` a rename is a **header rewrite**, not a data move: the value
already sits in the right column, only its name is wrong.

- **New name declared, old name gone** (the schema a deploy ships once its types
  are regenerated) — the migration rewrites that one header cell. No row is
  touched, so the cost is a single write no matter how large the table is, and a
  re-run writes nothing.
- **New name not declared** — `UnknownColumnError`. Regenerate your types (or
  add the column to the schema) and re-run.
- **The header cell holds neither name** — `SchemaMismatchError`, because the
  sheet is not laid out the way the schema says and rewriting would mislabel a
  live column.
- **Both names declared** — the two columns are real and distinct, so the header
  stays and the values move across (only where the source has a value and the
  target is empty), as a ranged read plus two ranged writes.

In-memory stores have no header: there, the rename *is* the value move.

Because the declared columns decide the layout, roll a rename back **under the
schema that rollback targets** — deploy the previous schema, then run
`rollback()`. A `down: (db) => db.renameColumn(newName, oldName)` executed while
the store still declares `newName` raises `UnknownColumnError` instead of
writing anything.

### How `removeColumn` is applied

:::danger Destructive — no undo
Removing a column deletes its values along with it. A `down` migration can
re-create the column, but **nothing can restore the data that was in it**. Take a
copy of the sheet before running a removal against production.
:::

- **Not declared in `columns`** (the post-removal schema) — the migration
  deletes the physical column, and the columns to its right shift left with
  their data. This is what keeps the deploy that no longer knows the column
  reading its own values: a column left behind would make every field to its
  right read the neighbour's cell and write into the abandoned one.
- **Still declared in `columns`** — the column is part of the store's positional
  map, so dropping it would misalign this very deploy. Its values are cleared
  with one ranged write and the column stays; the physical delete happens under
  the deploy whose schema no longer declares it. This is also what makes
  `down: (db) => db.removeColumn(...)` usable as the rollback of an `addColumn`.
- **Already gone from the sheet** — a no-op, so re-runs converge.
- **The rest of the header would not match the schema after the delete** —
  `SchemaMismatchError`, for the same reason as `addColumn`: shifting a
  misaligned sheet would move live data under the wrong headers.

In-memory stores have no physical column to drop: there, the removal clears the
key on every row.

## MigrationRunner

### Creating a Runner

```ts
import { createMigrationRunner, MockAdapter } from '@gsquery/core'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),  // stores migration history
  storeResolver: (tableName) => db.getStore(tableName),
  migrations
})
```

### Running Migrations

```ts
// Apply all pending migrations
const result = await runner.migrate()
// { applied: [{ version: 1, name: 'add-user-role' }, ...], currentVersion: 2 }

// Apply up to a specific version
const result = await runner.migrate({ to: 1 })
// { applied: [{ version: 1, name: 'add-user-role' }], currentVersion: 1 }
```

### Rolling Back

```ts
// Rollback the last migration
const result = await runner.rollback()
// { rolledBack: { version: 2, name: 'rename-email-to-emailAddress' }, currentVersion: 1 }

// Rollback all migrations
const result = await runner.rollbackAll()
// { rolledBack: [...], currentVersion: 0 }
```

### Checking Status

```ts
const status = runner.getStatus()
// {
//   currentVersion: 2,
//   applied: [{ id: 1, version: 1, name: 'add-user-role', appliedAt: '...' }, ...],
//   pending: []
// }

const version = runner.getCurrentVersion()     // 2
const applied = runner.getAppliedMigrations()  // MigrationRecord[]
const pending = runner.getPendingMigrations()  // Migration[]
```

## Full Example

```ts
import { defineSheetsDB, createMigrationRunner, MockAdapter } from '@gsquery/core'
import type { Migration } from '@gsquery/core'

// 1. Define your database
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' }
    }
  },
  mock: true
})

// 2. Seed data
db.from('users').batchInsert([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' }
])

// 3. Define migrations
const migrations: Migration[] = [
  {
    version: 1,
    name: 'add-role-column',
    up: (schema) => {
      schema.addColumn('users', 'role', { default: 'viewer' })
    },
    down: (schema) => {
      schema.removeColumn('users', 'role')
    }
  }
]

// 4. Create runner and migrate
const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),
  storeResolver: (table) => db.getStore(table),
  migrations
})

await runner.migrate()
// Users now have a 'role' column with default value 'viewer'
```

## Migration Rules

1. **Version numbers** must be positive integers (1, 2, 3...)
2. **No duplicate versions** -- each version must be unique
3. **Migrations must have both `up` and `down`** functions
4. **Migrations are applied in version order** (ascending)
5. **Rollbacks happen in reverse order** (last applied first)

## Error Handling

| Error | When |
|-------|------|
| `MigrationVersionError` | Invalid version number, duplicate version, or missing definition |
| `MigrationExecutionError` | An `up` or `down` function throws during execution |
| `NoMigrationsToRollbackError` | Calling `rollback()` when no migrations have been applied |

---

## See Also

- [CLI Reference](./cli-reference.md) -- `gsquery migrate` and `gsquery rollback` commands
- [Error Handling](./error-handling.md) -- All error types
- [Adapters](./adapters.md) -- How operations apply to each adapter
