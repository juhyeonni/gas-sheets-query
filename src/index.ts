/**
 * gas-sheets-query
 * TypeScript library for using Google Sheets as a database in GAS projects
 */

// Core types
export type {
  Row,
  Operator,
  SortDirection,
  WhereCondition,
  OrderByCondition,
  QueryOptions,
  DataStore,
  TableSchema,
  SheetsDBConfig
} from './core/types'

// Core classes
export { Repository } from './core/repository'

// Adapters
export { MockAdapter } from './adapters/mock-adapter'

export const VERSION = '0.1.0'
