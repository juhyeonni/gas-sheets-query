/**
 * gas-sheets-query
 * TypeScript library for using Google Sheets as a database in GAS projects
 */

// Core types
export type {
  Row,
  RowWithId,
  Operator,
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

// SheetsDB factory functions
export { createSheetsDB, defineSheetsDB } from './core/sheets-db'
export type { SheetsDB, TableHandle, CreateSheetsDBOptions, DefineSheetsDBOptions } from './core/sheets-db'

// Adapters
export { MockAdapter, MockAdapterOptions } from './adapters/mock-adapter'

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

export const VERSION = '0.1.0'
