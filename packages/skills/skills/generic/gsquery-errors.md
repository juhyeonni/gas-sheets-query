# gsquery — Errors

## Error Hierarchy

All errors extend `SheetsQueryError` (which extends `Error`).

```ts
import {
  SheetsQueryError,      // base — { code: string }
  TableNotFoundError,    // TABLE_NOT_FOUND — { tableName, availableTables }
  RowNotFoundError,      // ROW_NOT_FOUND — { id, tableName? }
  NoResultsError,        // NO_RESULTS — { tableName? }
  MissingStoreError,     // MISSING_STORE — { tableName }
  ValidationError,       // VALIDATION_ERROR — { field? }
  InvalidOperatorError,  // INVALID_OPERATOR — { operator, validOperators }
  MigrationVersionError, // MIGRATION_VERSION_ERROR — { version }
  MigrationExecutionError, // MIGRATION_EXECUTION_ERROR — { version, migrationName, cause }
  NoMigrationsToRollbackError, // NO_MIGRATIONS_TO_ROLLBACK
} from '@gsquery/core'
```

### Error Handling

```ts
try {
  db.from('users').findById(999)
} catch (e) {
  if (e instanceof RowNotFoundError) {
    console.log(`Row ${e.id} not found`)
  }
}

// Null-safe alternatives (no try/catch)
db.from('users').repo.findByIdOrNull(999)     // undefined
db.from('users').repo.updateOrNull(999, {})   // undefined
db.from('users').repo.deleteIfExists(999)     // false
db.from('users').query().first()              // undefined
```

## Common Mistakes

- Don't silently catch `SheetsQueryError` — use null-safe methods instead
