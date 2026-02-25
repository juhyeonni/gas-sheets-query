# gsquery — Errors & Visualization API

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

---

## Visualization API

Converts `QueryOptions` to Google Query Language for the Visualization API.

### Build Query

```ts
import { buildVizQuery, buildVizUrl, buildVizQueryResult } from '@gsquery/core'

const queryOpts = db.from('users').query()
  .where('active', '=', true)
  .orderBy('name')
  .limit(10)
  .build()

const query = buildVizQuery(queryOpts, {
  columnMap: { id: 'A', name: 'B', email: 'C', age: 'D', active: 'E' },
})
// "SELECT A, B, C, D, E WHERE E = true ORDER BY B ASC LIMIT 10"

const url = buildVizUrl('spreadsheet-id', query, { sheet: 'Users' })
```

### Parse Response

```ts
import { parseVizResponse } from '@gsquery/core'

const response = parseVizResponse<User>(responseText, ['id', 'name', 'email'])
// { status: 'ok' | 'warning' | 'error', rows: User[], columns: VizColumn[], rowCount: number }
```

### End-to-End Fetcher (GAS only)

```ts
import { createVizFetcher } from '@gsquery/core'

const fetcher = createVizFetcher('spreadsheet-id', {
  sheet: 'Users',
  columnMap: { id: 'A', name: 'B', email: 'C' },
})

const result = fetcher<User>(queryOpts, ['id', 'name', 'email'])
```

Uses `UrlFetchApp` with OAuth — GAS runtime only.

### VizQueryOptions

```ts
interface VizQueryOptions {
  columnMap?: Record<string, string>  // field → column letter
  sheet?: string | number             // sheet name or GID
  range?: string                      // e.g., 'A1:Z100'
}
```

### LIKE → Viz Conversion

| Pattern | Viz Query |
|---------|-----------|
| `%text%` | `contains` |
| `text%` | `starts with` |
| `%text` | `ends with` |
| `te_t` | `matches` (regex) |

## Common Mistakes

- Don't silently catch `SheetsQueryError` — use null-safe methods instead
- `createVizFetcher` only works in GAS — use `buildVizUrl` + manual fetch in Node.js
- `columnMap` must match your actual sheet column layout
