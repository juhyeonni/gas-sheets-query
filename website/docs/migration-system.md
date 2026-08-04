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
