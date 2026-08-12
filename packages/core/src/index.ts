/**
 * gas-sheets-query
 * TypeScript library for using Google Sheets as a database in GAS projects
 */

// Core types
export type {
  IdMode,
  Row,
  RowWithId,
  Operator,
  SingleValueOperator,
  ArrayValueOperator,
  SortDirection,
  WhereCondition,
  OrderByCondition,
  QueryOptions,
  DataStore,
  BatchUpdateItem,
  UpdateData,
  AddColumnOptions,
  TableSchema,
  SheetsDBConfig,
  RuntimeTableSchema,
  RuntimeSchema,
  // Schema-based type inference
  TypeSample,
  TableSchemaTyped,
  InferType,
  InferRowFromSchema,
  InferTablesFromConfig
} from './core/types.js'

// Core classes
export { Repository } from './core/repository.js'
export { QueryBuilder, createQueryBuilder } from './core/query-builder.js'
export type { AggSpec, AggResult, GroupedAggResult, HavingCondition } from './core/query-builder.js'
export { JoinQueryBuilder, createJoinQueryBuilder } from './core/join-query-builder.js'
export type { JoinConfig, StoreResolver } from './core/join-query-builder.js'

// SheetsDB factory functions
export { createSheetsDB, defineSheetsDB } from './core/sheets-db.js'
export type { SheetsDB, TableHandle, CreateSheetsDBOptions, DefineSheetsDBOptions } from './core/sheets-db.js'

// Adapters
export { MockAdapter } from './adapters/mock-adapter.js'
export type { MockAdapterOptions } from './adapters/mock-adapter.js'
export { SheetsAdapter, MAX_CELL_LENGTH, META_SHEET_NAME } from './adapters/sheets-adapter.js'
export type { ColumnType, SheetsAdapterOptions } from './adapters/sheets-adapter.js'

// Query utilities
export { evaluateCondition, compareRows } from './core/query-utils.js'

// Column type conversion
export { deserializeColumnValue, deserializeRow } from './core/column-conversion.js'

// Index Store
export { IndexStore, createIndexKey, serializeValues } from './core/index-store.js'
export type { IndexDefinition } from './core/index-store.js'

// Errors
export {
  SheetsQueryError,
  TableNotFoundError,
  RowNotFoundError,
  DuplicateIdError,
  NoResultsError,
  MissingStoreError,
  ValidationError,
  InvalidOperatorError,
  UnknownColumnError,
  SchemaMismatchError,
  // GAS platform errors (#136)
  LockTimeoutError,
  QuotaExceededError,
  SheetsApiError,
  CellSizeLimitError,
  classifyGasError,
  isTransientGasError
} from './core/errors.js'

// Bounded retry with backoff for transient GAS failures (#136)
export { withRetries, DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_BASE_DELAY_MS } from './core/gas-retry.js'
export type { RetryOptions } from './core/gas-retry.js'

// Migration System
export {
  MigrationRunner,
  createMigrationRunner,
  MigrationVersionError,
  MigrationExecutionError,
  NoMigrationsToRollbackError
} from './core/migration.js'
export type {
  Migration,
  MigrationRecord,
  MigrationResult,
  RollbackResult,
  MigrationRunnerConfig,
  SchemaBuilder,
  SchemaOperation,
  SchemaOperationType,
  ColumnOptions,
  StoreResolver as MigrationStoreResolver
} from './core/migration.js'
