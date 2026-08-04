# Errors Reference

## Error Hierarchy

All errors extend `SheetsQueryError`, which extends `Error`.

```ts
import {
  SheetsQueryError,
  TableNotFoundError,
  RowNotFoundError,
  NoResultsError,
  MissingStoreError,
  ValidationError,
  InvalidOperatorError,
  MigrationVersionError,
  MigrationExecutionError,
  NoMigrationsToRollbackError,
} from '@gsquery/core'
```

### Error Reference

| Error | Code | Thrown By | Properties |
|-------|------|-----------|------------|
| `SheetsQueryError` | varies | Base class | `code: string` |
| `TableNotFoundError` | `TABLE_NOT_FOUND` | `db.from('unknown')` | `tableName`, `availableTables` |
| `RowNotFoundError` | `ROW_NOT_FOUND` | `findById`, `update`, `delete` | `id`, `tableName?` |
| `NoResultsError` | `NO_RESULTS` | `firstOrFail()` | `tableName?` |
| `MissingStoreError` | `MISSING_STORE` | `getStore('unknown')` | `tableName` |
| `ValidationError` | `VALIDATION_ERROR` | Input validation | `field?` |
| `InvalidOperatorError` | `INVALID_OPERATOR` | `where()` with bad operator | `operator`, `validOperators` |
| `MigrationVersionError` | `MIGRATION_VERSION_ERROR` | Duplicate/invalid version | `version` |
| `MigrationExecutionError` | `MIGRATION_EXECUTION_ERROR` | Migration up/down fails | `version`, `migrationName`, `cause` |
| `NoMigrationsToRollbackError` | `NO_MIGRATIONS_TO_ROLLBACK` | `rollback()` when empty | — |

### Error Handling Patterns

```ts
import { RowNotFoundError, TableNotFoundError, SheetsQueryError } from '@gsquery/core'

// Catch specific errors
try {
  db.from('users').findById(999)
} catch (e) {
  if (e instanceof RowNotFoundError) {
    console.log(`Row ${e.id} not found in ${e.tableName}`)
  }
}

// Catch all gsquery errors
try {
  db.from('nonexistent')
} catch (e) {
  if (e instanceof SheetsQueryError) {
    console.log(`gsquery error [${e.code}]: ${e.message}`)
  }
}

// Null-safe alternatives (no try/catch needed)
const user = db.from('users').repo.findByIdOrNull(999)   // undefined
const updated = db.from('users').repo.updateOrNull(999, { age: 30 })  // undefined
const deleted = db.from('users').repo.deleteIfExists(999)  // false
const first = db.from('users').query().where('age', '>', 100).first()  // undefined
```

## Anti-Patterns

```ts
// WRONG: suppressing SheetsQueryError and continuing
try { db.from('users').findById(1) } catch (e) { /* silent */ }
// RIGHT: handle specific error types or use null-safe methods
const user = db.from('users').repo.findByIdOrNull(1)

// WRONG: catching Error broadly and assuming it is a gsquery error
try { db.from('users').findById(1) } catch (e) { console.log(e.code) }  // code may be undefined
// RIGHT: narrow with instanceof before reading gsquery-specific fields
try { db.from('users').findById(1) } catch (e) {
  if (e instanceof SheetsQueryError) console.log(e.code)
}
```
