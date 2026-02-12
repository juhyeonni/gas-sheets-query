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
export { JoinQueryBuilder, createJoinQueryBuilder, JoinConfig, StoreResolver } from './core/join-query-builder'

// SheetsDB factory functions
export { createSheetsDB, defineSheetsDB } from './core/sheets-db'
export type { SheetsDB, TableHandle, CreateSheetsDBOptions, DefineSheetsDBOptions } from './core/sheets-db'

// Adapters
export { MockAdapter, MockAdapterOptions } from './adapters/mock-adapter'
export { SheetsAdapter, SheetsAdapterOptions } from './adapters/sheets-adapter'

// Query utilities
export { evaluateCondition, compareRows } from './core/query-utils'

// Index Store
export { IndexStore, IndexDefinition, createIndexKey, serializeValues } from './core/index-store'

// Visualization API Query
export {
  buildVizQuery,
  buildVizUrl,
  buildVizQueryResult,
  parseVizResponse,
  createVizFetcher
} from './core/viz-query'
export type {
  VizQueryOptions,
  VizQueryResult,
  VizApiResponse,
  VizColumn
} from './core/viz-query'

// Errors
export {
  SheetsQueryError,
  TableNotFoundError,
  RowNotFoundError,
  NoResultsError,
  MissingStoreError,
  ValidationError,
  InvalidOperatorError
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
