# Errors & Visualization API Reference

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

---

## Visualization API

Build and execute Google Visualization API queries. Converts `QueryOptions` to Google Query Language (SQL-like syntax). Useful for server-side query offloading.

### Functions

```ts
import {
  buildVizQuery,
  buildVizUrl,
  buildVizQueryResult,
  parseVizResponse,
  createVizFetcher,
} from '@gsquery/core'
```

### buildVizQuery — Generate Query String

```ts
const queryOpts = db.from('users').query()
  .where('active', '=', true)
  .where('age', '>=', 18)
  .orderBy('name')
  .limit(10)
  .build()

const query = buildVizQuery(queryOpts, {
  columnMap: { id: 'A', name: 'B', email: 'C', age: 'D', active: 'E' },
})
// "SELECT A, B, C, D, E WHERE E = true AND D >= 18 ORDER BY B ASC LIMIT 10"
```

### buildVizUrl — Generate Full API URL

```ts
const url = buildVizUrl('spreadsheet-id', query, { sheet: 'Users' })
// "https://docs.google.com/spreadsheets/d/spreadsheet-id/gviz/tq?tq=SELECT+...&sheet=Users"
```

### buildVizQueryResult — Combined Query + URL

```ts
const result = buildVizQueryResult('spreadsheet-id', queryOpts, {
  columnMap: { id: 'A', name: 'B' },
  sheet: 'Users',
})
// { query: 'encoded-query', rawQuery: 'raw-query', url: 'full-url' }
```

### parseVizResponse — Parse API Response

```ts
const response = parseVizResponse<User>(responseText, ['id', 'name', 'email'])
// { status: 'ok', rows: User[], columns: VizColumn[], rowCount: number }
```

### createVizFetcher — End-to-End Fetcher (GAS Only)

```ts
const fetcher = createVizFetcher('spreadsheet-id', {
  sheet: 'Users',
  columnMap: { id: 'A', name: 'B', email: 'C' },
})

const queryOpts = db.from('users').query()
  .where('active', '=', true)
  .build()

const result = fetcher<User>(queryOpts, ['id', 'name', 'email'])
// result.status, result.rows, result.columns, result.rowCount
```

Uses `UrlFetchApp` with OAuth bearer token internally. Works only in GAS runtime.

### VizQueryOptions

```ts
interface VizQueryOptions {
  columnMap?: Record<string, string>  // field name → column letter (A, B, C...)
  sheet?: string | number             // sheet name or GID
  range?: string                      // e.g., 'A1:Z100'
}
```

### VizApiResponse

```ts
interface VizApiResponse<T> {
  status: 'ok' | 'warning' | 'error'
  rows: T[]
  columns: VizColumn[]
  messages?: string[]
  rowCount: number
}

interface VizColumn {
  id: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'timeofday'
}
```

### LIKE → Viz Query Conversion

| Pattern | Viz Query |
|---------|-----------|
| `%text%` | `contains` |
| `text%` | `starts with` |
| `%text` | `ends with` |
| `te_t` | `matches` (regex) |

## Anti-Patterns

```ts
// WRONG: suppressing SheetsQueryError and continuing
try { db.from('users').findById(1) } catch (e) { /* silent */ }
// RIGHT: handle specific error types or use null-safe methods
const user = db.from('users').repo.findByIdOrNull(1)

// WRONG: using createVizFetcher in Node.js — UrlFetchApp is GAS-only
// RIGHT: use buildVizQuery + buildVizUrl and fetch manually in Node.js

// WRONG: columnMap with wrong letters
buildVizQuery(opts, { columnMap: { name: 'A' } })  // A is actually id column
// RIGHT: verify column order matches your sheet layout
```
