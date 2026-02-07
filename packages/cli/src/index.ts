/**
 * gsquery - CLI for gas-sheets-query schema generation
 */

// Generate command
export { generateCommand, runGenerate, generateIndex } from './commands/generate.js'
export type { GenerateOptions, GenerateResult } from './commands/generate.js'

// Init command
export { initCommand, runInit, loadConfig } from './commands/init.js'
export type { InitOptions, InitResult, GSQConfig } from './commands/init.js'

// Migration commands
export { migrationCreateCommand, runMigrationCreate } from './commands/migration-create.js'
export type { MigrationCreateOptions, MigrationCreateResult } from './commands/migration-create.js'

export { migrateCommand, runMigrate } from './commands/migrate.js'
export type { MigrateOptions, MigrateResult } from './commands/migrate.js'

export { rollbackCommand, runRollback } from './commands/rollback.js'
export type { RollbackOptions, RollbackResult } from './commands/rollback.js'

// Parser and generators
export { parseSchema, parseSchemaFile } from './parser/schema-parser.js'
export { generateTypes } from './generator/types-generator.js'
export { generateClient } from './generator/client-generator.js'

export const VERSION = '0.1.0'
