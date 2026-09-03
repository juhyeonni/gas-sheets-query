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
```

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
  constructor(options: SheetsAdapterOptions)

  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: Omit<T, 'id'> | T): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert(items: (Omit<T, 'id'> | T)[]): T[]
  batchUpdate(items: BatchUpdateItem<T>[]): T[]

  clearCache(): void
  reset(data?: T[]): void
  getRawData(): unknown[][]
}

interface SheetsAdapterOptions {
  spreadsheetId?: string
  sheetName: string
  columns: string[]
  createIfNotExists?: boolean       // default: true
  idColumn?: string                 // default: 'id'
  idMode?: 'auto' | 'client'       // default: 'auto'
  columnTypes?: Record<string, ColumnType>
}

type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]' | 'object' | 'json'
```

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
class IndexStore<T extends Row> {
  constructor(definitions?: IndexDefinition[])

  getDefinitions(): IndexDefinition[]
  hasIndex(fields: string[]): boolean
  addToIndex(rowIndex: number, row: T): void
  removeFromIndex(rowIndex: number, row: T): void
  updateIndex(rowIndex: number, oldRow: T, newRow: T): void
  rebuild(data: T[]): void
  lookup(fields: string[], values: unknown[]): Set<number> | undefined
  findIndexByPrefix(fields: string[]): IndexDefinition | undefined
  reindexAfterDelete(deletedIndex: number): void
  clear(): void
}

interface IndexDefinition {
  fields: string[]
  unique?: boolean
}
```

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
