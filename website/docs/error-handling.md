# Error Handling

gas-sheets-query uses a hierarchy of typed errors with error codes for programmatic handling.

## Error Hierarchy

```
Error
 └── SheetsQueryError (base)
      ├── TableNotFoundError
      ├── RowNotFoundError
      ├── DuplicateIdError
      ├── NoResultsError
      ├── MissingStoreError
      ├── ValidationError
      ├── InvalidOperatorError
      ├── MigrationVersionError
      ├── MigrationExecutionError
      └── NoMigrationsToRollbackError
```

## Error Types

### SheetsQueryError

Base class for all gas-sheets-query errors.

```ts
class SheetsQueryError extends Error {
  readonly code: string
}
```

### TableNotFoundError

Thrown when accessing a table that doesn't exist in the configuration.

```ts
try {
  db.from('nonexistent')
} catch (e) {
  if (e instanceof TableNotFoundError) {
    console.log(e.code)            // 'TABLE_NOT_FOUND'
    console.log(e.tableName)       // 'nonexistent'
    console.log(e.availableTables) // ['users', 'posts']
  }
}
```

### RowNotFoundError

Thrown by throwing variants of `findById`, `update`, and `delete`.

```ts
try {
  db.from('users').findById(999)
} catch (e) {
  if (e instanceof RowNotFoundError) {
    console.log(e.code)      // 'ROW_NOT_FOUND'
    console.log(e.id)        // 999
    console.log(e.tableName) // 'users'
  }
}
```

### DuplicateIdError

Thrown by `insert()`/`batchInsert()` on a `idMode: 'client'` store when the
supplied id already exists (including a duplicate inside the same batch). On
`SheetsAdapter` the check runs under the write lock, so a concurrent execution
that inserts the same id first wins and this one throws instead of writing a
row that no id lookup could ever reach.

```ts
try {
  db.from('users').insert({ id: 'u-1', name: 'Alice' })
} catch (e) {
  if (e instanceof DuplicateIdError) {
    console.log(e.code)      // 'DUPLICATE_ID'
    console.log(e.id)        // 'u-1'
    console.log(e.tableName) // 'users'
  }
}
```

Every adapter enforces the same rule, so code that passes against the test
double behaves the same in production: `MockAdapter` and the client-side
`LocalAdapter` reject duplicates too, and a rejected write mutates nothing —
no row, and on `LocalAdapter` no queued mutation and no IndexedDB write, so the
duplicate fails at the call site instead of being pushed and dead-lettered.
Ids are compared as strings, so `1` collides with `'1'`. `MockAdapter` has no
table name and leaves `e.tableName` undefined. Rows seeded outside the insert
path — `initialData`, `reset()`, `LocalAdapter.replaceAll()` (a sync pull), or
rows already on the sheet — are taken verbatim and are not checked.

### NoResultsError

Thrown by `firstOrFail()` when no results match the query.

```ts
try {
  db.from('users').query()
    .where('email', '=', 'nobody@example.com')
    .firstOrFail()
} catch (e) {
  if (e instanceof NoResultsError) {
    console.log(e.code) // 'NO_RESULTS'
  }
}
```

### MissingStoreError

Thrown when a table in the configuration doesn't have a corresponding data store.

```ts
// code: 'MISSING_STORE'
// tableName: 'users'
```

### ValidationError

Thrown when input validation fails.

```ts
// code: 'VALIDATION_ERROR'
// field?: string (optional field name)
```

### InvalidOperatorError

Thrown when an invalid query operator is used.

```ts
// code: 'INVALID_OPERATOR'
// operator: string (the invalid operator)
// validOperators: string[] (list of valid operators)
```

### UnknownColumnError

Thrown by a schema migration when the target column is not part of the store's
declared schema. A positional store (`SheetsAdapter`) cannot hold a value for an
undeclared column, so the migration fails instead of silently doing nothing.

```ts
// code: 'UNKNOWN_COLUMN'
// column: string (the column the migration asked for)
// tableName: string (sheet name)
// declaredColumns: string[] (columns the store knows about)
```

### SchemaMismatchError

Thrown by a schema migration when the sheet's physical header contradicts the
declared columns; writing into a misaligned sheet would corrupt data.

```ts
// code: 'SCHEMA_MISMATCH'
// tableName: string (sheet name)
// actualHeader: string[] (header currently in the sheet)
// declaredColumns: string[] (columns the store was created with)
```

### MigrationVersionError

Thrown for invalid migration version numbers or configurations.

```ts
try {
  createMigrationRunner({ ... })
} catch (e) {
  if (e instanceof MigrationVersionError) {
    console.log(e.code)    // 'MIGRATION_VERSION_ERROR'
    console.log(e.version) // the invalid version number
  }
}
```

### MigrationExecutionError

Thrown when a migration's `up` or `down` function fails.

```ts
try {
  await runner.migrate()
} catch (e) {
  if (e instanceof MigrationExecutionError) {
    console.log(e.code)          // 'MIGRATION_EXECUTION_ERROR'
    console.log(e.version)       // migration version that failed
    console.log(e.migrationName) // migration name
    console.log(e.cause)         // original Error
  }
}
```

### NoMigrationsToRollbackError

Thrown when calling `rollback()` with no applied migrations.

```ts
try {
  await runner.rollback()
} catch (e) {
  if (e instanceof NoMigrationsToRollbackError) {
    console.log(e.code) // 'NO_MIGRATIONS_TO_ROLLBACK'
  }
}
```

## Error Codes Reference

| Code | Error Class | When |
|------|-------------|------|
| `TABLE_NOT_FOUND` | `TableNotFoundError` | `db.from('unknown')` |
| `ROW_NOT_FOUND` | `RowNotFoundError` | `findById(999)`, `update(999, ...)`, `delete(999)` |
| `NO_RESULTS` | `NoResultsError` | `query.firstOrFail()` with no matches |
| `MISSING_STORE` | `MissingStoreError` | Table config without matching store |
| `VALIDATION_ERROR` | `ValidationError` | Input validation failure |
| `INVALID_OPERATOR` | `InvalidOperatorError` | Invalid operator in where clause |
| `UNKNOWN_COLUMN` | `UnknownColumnError` | `addColumn`, or `renameColumn`'s new name, for a column outside the store schema |
| `SCHEMA_MISMATCH` | `SchemaMismatchError` | Sheet header contradicts the declared columns (also raised by `renameColumn`/`removeColumn` when the physical layout does not match) |
| `MIGRATION_VERSION_ERROR` | `MigrationVersionError` | Invalid migration version |
| `MIGRATION_EXECUTION_ERROR` | `MigrationExecutionError` | Migration up/down failure |
| `NO_MIGRATIONS_TO_ROLLBACK` | `NoMigrationsToRollbackError` | Rollback with no applied migrations |

## Handling Patterns

### Catch Specific Errors

```ts
import { RowNotFoundError, TableNotFoundError, SheetsQueryError } from '@gsquery/core'

try {
  const user = db.from('users').findById(id)
} catch (e) {
  if (e instanceof RowNotFoundError) {
    return { error: 'User not found', id: e.id }
  }
  if (e instanceof TableNotFoundError) {
    return { error: 'Invalid table', available: e.availableTables }
  }
  if (e instanceof SheetsQueryError) {
    return { error: e.message, code: e.code }
  }
  throw e // re-throw unexpected errors
}
```

### Use Nullable Variants to Avoid Errors

```ts
// Instead of try/catch for missing rows:
const user = db.from('users').repo.findByIdOrNull(id)
if (!user) {
  // handle missing user
}

const result = db.from('users').query()
  .where('email', '=', email)
  .first()  // returns undefined instead of throwing
```

### Check by Error Code

```ts
try {
  // ...
} catch (e) {
  if (e instanceof SheetsQueryError) {
    switch (e.code) {
      case 'ROW_NOT_FOUND':
        // handle missing row
        break
      case 'TABLE_NOT_FOUND':
        // handle missing table
        break
      default:
        // handle other gsquery errors
    }
  }
}
```

---

## See Also

- [CRUD Operations](./crud-operations.md) -- Throwing vs nullable method variants
- [Migration System](./migration-system.md) -- Migration-specific errors
- [API Reference](./api-reference.md) -- Complete type signatures
