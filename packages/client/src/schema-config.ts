/**
 * Runtime schema -> SheetsDB table config, shared by the server path
 * (`createClientFactory`) and the local-first path (`createClientDB`) so both
 * hand the same column metadata to `createSheetsDB` (#135, #199).
 */
import type { RuntimeSchema, RuntimeTableSchema, SheetsDBConfig } from '@gsquery/core'

/** One table's entry in {@link SheetsDBConfig} */
type TableConfig = SheetsDBConfig['tables'][string]

/** Table config for one runtime table: columns, sheet name, defaults and `@updatedAt` fields */
export function toTableConfig(table: RuntimeTableSchema): TableConfig {
  const config: TableConfig = { columns: [...table.columns], sheetName: table.sheetName }
  if (table.defaults) config.defaults = table.defaults
  if (table.updatedAt) config.updatedAt = table.updatedAt
  return config
}

/** `createSheetsDB` config for every table of a runtime schema */
export function toSheetsDBConfig(schema: RuntimeSchema): SheetsDBConfig {
  return {
    tables: Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [name, toTableConfig(table)])
    )
  }
}
