# API Reference

Complete type and method reference for all three packages.

## @gsquery/core

### Factory Functions

#### `defineSheetsDB(options)`

Create a `SheetsDB` instance with automatic type inference from schema.

```ts
function defineSheetsDB<const TableSchemas extends Record<string, TableSchemaTyped>>(
  options: DefineSheetsDBOptions<TableSchemas>
): SheetsDB<InferTablesFromConfig<TableSchemas>>
```

**Options:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tables` | `Record<string, TableSchemaTyped>` | Yes | Table schemas with columns and type hints |
| `stores` | `Record<string, DataStore>` | No | Custom data stores per table |
| `mock` | `boolean` | No | Use MockAdapter for all tables |
| `spreadsheetId` | `string` | No | Google Spreadsheet ID |

> Either `stores` or `mock: true` must be provided.

#### `createSheetsDB(options)` (Legacy)

Create a `SheetsDB` instance with explicit type parameters.

```ts
function createSheetsDB<Tables extends Record<string, RowWithId>>(
  options: CreateSheetsDBOptions<Tables>
): SheetsDB<Tables>

interface CreateSheetsDBOptions<Tables> {
  config: TypedSheetsDBConfig<Tables>
  stores: { [K in keyof Tables]: DataStore<Tables[K]> }
}

interface TypedSheetsDBConfig<Tables> {
  spreadsheetId?: string
  tables: { [K in keyof Tables]: TableSchema<Tables[K]> }  // one entry per table, like stores
}

interface TableSchema<T extends RowWithId = RowWithId> {
  columns: readonly ColumnName<T>[]  // only T's keys; `as const` tuples accepted
  sheetName?: string
  idColumn?: string                  // deprecated
}

// T's string keys; any string when T is exactly the bare RowWithId (no row type given)
type ColumnName<T extends RowWithId>
```

Each table's `columns` is checked against its row type, so a typo fails to compile where it is written:

```ts
interface User { id: number; name: string; email: string }

createSheetsDB<{ users: User }>({
  config: { tables: { users: { columns: ['id', 'name', 'emial'] } } },
  //                                                  ~~~~~~~ not a key of User
  stores: { users: new MockAdapter<User>() }
})
```

Called with no type argument and untyped stores, every table is the bare `RowWithId` and any column name is accepted. `SheetsDB.config` exposes the erased `SheetsDBConfig`, whose column lists are plain strings; a typed config is assignable to it, but not the other way round.

**Migrating from 1.x (2.0, #246):**

- A column the sheet has but the row type does not declare: add it to the row type. The store already returns it in every row.
- A column list held in a `string[]` variable: type it as the row's keys, `(keyof User & string)[]`, or write it as an `as const` tuple.
- A config typed as `SheetsDBConfig` (erased) passed to `createSheetsDB<Tables>`: type it as `TypedSheetsDBConfig<Tables>`, or drop the annotation and let the call check it.
- A table that has a store but no `config.tables` entry: add the entry. `from()` on such a table threw `TableNotFoundError` at runtime; it now fails to compile.

---

### SheetsDB

```ts
interface SheetsDB<Tables> {
  from<K extends keyof Tables & string>(tableName: K): TableHandle<Tables[K]>
  getStore<K extends keyof Tables & string>(tableName: K): DataStore<Tables[K]>
  readonly config: SheetsDBConfig
}
```

---

### TableHandle

```ts
interface TableHandle<T extends RowWithId> {
  readonly repo: Repository<T>
  query(): QueryBuilder<T>
  joinQuery(): JoinQueryBuilder<T>
  create(data: T | Omit<T, 'id'>): T
  findById(id: string | number): T                    // throws RowNotFoundError
  findAll(): T[]
  update(id: string | number, data: Partial<T>): T    // throws RowNotFoundError
  upsert(data: UpsertData<T>): T                       // update by id, else insert
  delete(id: string | number): void                    // throws RowNotFoundError
  batchInsert(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate(items: { id: string | number; data: Partial<T> }[]): T[]
  batchDelete(ids: (string | number)[]): number        // missing ids skipped; returns rows deleted
}
```

---

### Repository

```ts
class Repository<T extends RowWithId> {
  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T                      // throws RowNotFoundError
  findByIdOrNull(id: string | number): T | undefined
  create(data: T | Omit<T, 'id'>): T
  update(id: string | number, data: Partial<T>): T      // throws RowNotFoundError
  updateOrNull(id: string | number, data: Partial<T>): T | undefined
  upsert(data: UpsertData<T>): T                         // update by id, else insert
  delete(id: string | number): void                      // throws RowNotFoundError
  deleteIfExists(id: string | number): boolean
  count(): number
  exists(id: string | number): boolean
  batchInsert(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate(items: { id: string | number; data: Partial<T> }[]): T[]
  batchDelete(ids: (string | number)[]): number        // missing ids skipped; returns rows deleted
}
```

---

### QueryBuilder

```ts
class QueryBuilder<T extends RowWithId> {
  // Where conditions
  where<K extends keyof T & string>(field: K, operator: Operator, value: T[K]): this
  where<K extends keyof T & string>(field: K, operator: 'in', value: T[K][]): this
  whereEq<K extends keyof T & string>(field: K, value: T[K]): this
  whereNot<K extends keyof T & string>(field: K, value: T[K]): this
  whereIn<K extends keyof T & string>(field: K, values: T[K][]): this
  whereLike<K extends keyof T & string>(field: K, pattern: string): this

  // Sorting
  orderBy<K extends keyof T & string>(field: K, direction?: SortDirection): this

  // Pagination
  limit(count: number): this
  offset(count: number): this
  page(pageNumber: number, pageSize: number): this

  // Execution
  exec(): T[]
  first(): T | undefined
  firstOrFail(): T                    // throws NoResultsError
  count(): number
  exists(): boolean

  // Aggregation
  sum<K extends keyof T & string>(field: K): number
  avg<K extends keyof T & string>(field: K): number | null
  min<K extends keyof T & string>(field: K): number | null
  max<K extends keyof T & string>(field: K): number | null

  // Grouped aggregation
  groupBy<K extends keyof T & string>(...fields: K[]): this
  having(aggName: string, operator: Operator, value: number): this
  agg<A extends Record<string, AggSpec>>(specs: A): GroupedAggResult<...>[]

  // Utility
  build(): QueryOptions<T>
  clone(): QueryBuilder<T>
}
```

**Operators:** `'=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in'`

**AggSpec:** `'count' | 'sum:field' | 'avg:field' | 'min:field' | 'max:field'`

---

### JoinQueryBuilder

```ts
class JoinQueryBuilder<T extends RowWithId> {
  // Joins
  join(table: string, localField: keyof T & string, foreignField?: string, options?: { as?: string; type?: 'left' | 'inner' }): this
  leftJoin(table: string, localField: keyof T & string, foreignField?: string, options?: { as?: string }): this
  innerJoin(table: string, localField: keyof T & string, foreignField?: string, options?: { as?: string }): this

  // Where, sorting, pagination (same as QueryBuilder)
  where(...): this
  whereEq(...): this
  whereNot(...): this
  whereIn(...): this
  whereLike(...): this
  orderBy(...): this
  limit(count: number): this
  offset(count: number): this
  page(pageNumber: number, pageSize: number): this

  // Execution
  exec(): (T & Record<string, unknown>)[]
  first(): (T & Record<string, unknown>) | undefined
  firstOrFail(): T & Record<string, unknown>     // throws NoResultsError
  count(): number
  exists(): boolean

  // Utility
  build(): QueryOptions<T>
  clone(): JoinQueryBuilder<T>
}
```

---

### MockAdapter

```ts
class MockAdapter<T extends RowWithId> implements DataStore<T> {
  constructor(initialData?: T[] | MockAdapterOptions<T>)

  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: Omit<T, 'id'> | T): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert(items: (Omit<T, 'id'> | T)[]): T[]
  batchUpdate(items: BatchUpdateItem<T>[]): T[]
  batchDelete(ids: (string | number)[]): number

  // Test helpers
  reset(data?: T[]): void
  getRawData(): T[]
}

interface MockAdapterOptions<T> {
  initialData?: T[]
  indexes?: IndexDefinition[]
  idMode?: 'auto' | 'client'
}
```

---

### SheetsAdapter

```ts
class SheetsAdapter<T extends RowWithId> implements DataStore<T> {
  constructor(options: SheetsAdapterOptions<T>)

  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: Omit<T, 'id'> | T): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert(items: (Omit<T, 'id'> | T)[]): T[]
  batchUpdate(items: BatchUpdateItem<T>[]): T[]
  batchDelete(ids: (string | number)[]): number
  /** Rows with a non-empty id cell; 0 reads when the cache is warm, else one id-column read */
  count(): number

  clearCache(): void
  reset(data?: T[]): void
  getRawData(): unknown[][]
}

interface SheetsAdapterOptions<T extends RowWithId = RowWithId> {
  spreadsheetId?: string
  sheetName: string
  columns: readonly ColumnName<T>[] // only T's keys; any string when no row type is given
  createIfNotExists?: boolean       // default: true
  idColumn?: string                 // default: 'id'
  idMode?: 'auto' | 'client'       // default: 'auto'
  columnTypes?: Record<string, ColumnType>
  allowFormulas?: boolean           // default: false
  skipHeaderCheck?: boolean         // default: false
}

type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]' | 'object' | 'json'
```

`columns` is typed against the row type (#246). It is what a new sheet's header row is written from and what the header-drift check compares the sheet against, so a typo here can only be caught by the compiler:

```ts
interface User { id: number; name: string; email: string }

new SheetsAdapter<User>({ sheetName: 'Users', columns: ['id', 'name', 'email'] })  // ok
new SheetsAdapter<User>({ sheetName: 'Users', columns: ['id', 'emial'] })          // error: 'emial'

const columns = ['id', 'name', 'email'] as const
new SheetsAdapter<User>({ sheetName: 'Users', columns })                           // ok: readonly tuple

new SheetsAdapter({ sheetName: 'Users', columns: ['id', 'anything'] })             // ok: no row type, SheetsAdapter<RowWithId>
```

A row type whose fields besides `id` are all optional is still checked; only the bare `RowWithId` accepts any string.

**Migrating from 1.x (2.0, #246):**

- A column the sheet has but `T` does not declare: add it to `T`. The adapter already returns every listed column in every row.
- A column list held in a `string[]` variable: type it as `(keyof User & string)[]`, or write it as an `as const` tuple.

---

### MigrationRunner

```ts
class MigrationRunner {
  constructor(config: MigrationRunnerConfig)

  getCurrentVersion(): number
  getAppliedMigrations(): MigrationRecord[]
  getPendingMigrations(): Migration[]
  getStatus(): { currentVersion: number; applied: MigrationRecord[]; pending: Migration[] }

  migrate(options?: { to?: number }): Promise<MigrationResult>
  rollback(): Promise<RollbackResult>
  rollbackAll(): Promise<{ rolledBack: { version: number; name: string }[]; currentVersion: number }>
}

function createMigrationRunner(config: MigrationRunnerConfig): MigrationRunner

interface MigrationRunnerConfig {
  migrationsStore: DataStore<MigrationRecord>
  storeResolver: <T extends RowWithId>(tableName: string) => DataStore<T>
  migrations: Migration[]
}

interface Migration {
  version: number
  name: string
  up: (db: SchemaBuilder) => void | Promise<void>
  down: (db: SchemaBuilder) => void | Promise<void>
}

interface SchemaBuilder {
  addColumn<T>(table: string, column: string, options?: ColumnOptions<T>): void
  removeColumn(table: string, column: string): void
  renameColumn(table: string, oldName: string, newName: string): void
}
```

---

### IndexStore

```ts
class IndexStore<T extends Row, K = number> {
  constructor(definitions?: IndexDefinition[])

  getDefinitions(): IndexDefinition[]
  hasIndex(fields: string[]): boolean
  addToIndex(key: K, row: T): void
  removeFromIndex(key: K, row: T): void
  updateIndex(key: K, oldRow: T, newRow: T): void
  rebuild(this: IndexStore<T, number>, data: T[]): void
  lookup(fields: string[], values: unknown[]): Set<K> | undefined
  candidates(conditions: WhereCondition<T>[]): { keys: K[]; remaining: WhereCondition<T>[] } | undefined
  reindexAfterDelete(this: IndexStore<T, number>, deletedIndex: number): void
  clear(): void
  debugDump(): Record<string, Record<string, K[]>>
}

interface IndexDefinition {
  fields: string[]
  unique?: boolean
}
```

`assertClientIdsAvailable(idIndex, ids, tableName?)` rejects client-supplied ids that exist in `idIndex` or repeat within `ids` (two ids collide iff `String(a) === String(b)`), throwing `DuplicateIdError`. It reads only the id map: O(K) for K ids.

---

### Error Classes

```ts
class SheetsQueryError extends Error { readonly code: string }
class TableNotFoundError extends SheetsQueryError { tableName: string; availableTables: string[] }
class RowNotFoundError extends SheetsQueryError { id: string | number; tableName?: string }
class NoResultsError extends SheetsQueryError { tableName?: string }
class MissingStoreError extends SheetsQueryError { tableName: string }
class ValidationError extends SheetsQueryError { field?: string }
class InvalidOperatorError extends SheetsQueryError { operator: string; validOperators: string[] }
class MigrationVersionError extends SheetsQueryError { version: number }
class MigrationExecutionError extends SheetsQueryError { version: number; migrationName: string; cause: Error }
class NoMigrationsToRollbackError extends SheetsQueryError {}
```

---

### Core Types

```ts
type IdMode = 'auto' | 'client'
type Row = Record<string, unknown>
type RowWithId = { id: string | number }
type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in'
type SortDirection = 'asc' | 'desc'
type TypeSample = string | number | boolean | null | Date

interface WhereCondition<T> { field: keyof T & string; operator: Operator; value: unknown }
interface OrderByCondition<T> { field: keyof T & string; direction: SortDirection }
interface QueryOptions<T> { where: WhereCondition<T>[]; orderBy: OrderByCondition<T>[]; limitValue?: number; offsetValue?: number }
interface BatchUpdateItem<T> { id: string | number; data: Partial<T> }
type UpdateData<T> = Partial<Omit<T, 'id'>>
type UpsertData<T> = Omit<T, 'id'> | (UpdateData<T> & Pick<T, 'id'>)
```

---

## @gsquery/cli

### Commands

| Command | Description |
|---------|-------------|
| `gsquery init` | Create a gsquery configuration file |
| `gsquery generate` | Generate TypeScript types (and optional client) from schema |
| `gsquery migrate` | Preview pending migrations |
| `gsquery rollback` | Preview a migration rollback |
| `gsquery migration:create <name>` | Create new migration file |

### Exports

```ts
// Commands (commander Command objects + run* helpers)
export { generateCommand, runGenerate, generateIndex }
export { initCommand, runInit, loadConfig }
export { migrateCommand, runMigrate }
export { rollbackCommand, runRollback }
export { migrationCreateCommand, runMigrationCreate }

// Parser
export { parseSchema, parseSchemaFile, validateSchema }

// Generators
export { generateTypes, generateClient }
```

---

## @gsquery/client

### Exports

```ts
export { createClientFactory, createMockClient, createStore }
export { isGASEnvironment, isNodeEnvironment }
export { SheetsAdapter, MockAdapter }
export { TableNotFoundError, RowNotFoundError, ValidationError }
```

---

## See Also

- [Error Handling](./error-handling.md) -- Detailed error types and handling patterns
- [Architecture Overview](./architecture-overview.md) -- How all components fit together
- [Home](./index.md) -- Quick start and table of contents
