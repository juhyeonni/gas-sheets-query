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
  // Schema-based type inference
  TypeSample,
  TableSchemaTyped,
  InferType,
  InferRowFromSchema,
  InferTablesFromConfig
} from './core/types'

// Core classes
export { Repository } from './core/repository'
export { QueryBuilder, createQueryBuilder } from './core/query-builder'
export type { AggSpec, AggResult, GroupedAggResult, HavingCondition } from './core/query-builder'
export { JoinQueryBuilder, createJoinQueryBuilder } from './core/join-query-builder'
export type { JoinConfig, StoreResolver } from './core/join-query-builder'

// SheetsDB factory functions
export { createSheetsDB, defineSheetsDB } from './core/sheets-db'
export type { SheetsDB, TableHandle, CreateSheetsDBOptions, DefineSheetsDBOptions } from './core/sheets-db'

// Adapters
export { MockAdapter } from './adapters/mock-adapter'
export type { MockAdapterOptions } from './adapters/mock-adapter'
export { SheetsAdapter } from './adapters/sheets-adapter'
export type { ColumnType, SheetsAdapterOptions } from './adapters/sheets-adapter'

// Query utilities
export { evaluateCondition, compareRows } from './core/query-utils'

// Index Store
export { IndexStore, createIndexKey, serializeValues } from './core/index-store'
export type { IndexDefinition } from './core/index-store'

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
  SchemaMismatchError
} from './core/errors'

// Migration System
export {
  MigrationRunner,
  createMigrationRunner,
  MigrationVersionError,
  MigrationExecutionError,
  NoMigrationsToRollbackError
} from './core/migration'
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
} from './core/migration'
