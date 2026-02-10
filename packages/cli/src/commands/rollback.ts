/**
 * Rollback command - rollback the last migration
 * 
 * Issue #12
 */

import { Command } from 'commander'
import { existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { pathToFileURL } from 'url'
import { loadConfig } from './init.js'
import { toError } from '../utils/errors.js'

// =============================================================================
// Types
// =============================================================================

export interface RollbackOptions {
  dir?: string
  all?: boolean
  steps?: number
}

export interface RollbackResult {
  success: boolean
  rolledBack: { version: number; name: string }[]
  currentVersion: number
  error?: string
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Schema builder interface (local definition to avoid import issues)
 */
interface SchemaBuilder {
  addColumn<T = unknown>(table: string, column: string, options?: { default?: T; type?: string }): void
  removeColumn(table: string, column: string): void
  renameColumn(table: string, oldName: string, newName: string): void
}

/**
 * Migration definition (local)
 */
interface MigrationDef {
  version: number
  name: string
  up: (db: SchemaBuilder) => void | Promise<void>
  down: (db: SchemaBuilder) => void | Promise<void>
}

/**
 * Load migration files from directory
 */
async function loadMigrations(migrationsDir: string): Promise<MigrationDef[]> {
  if (!existsSync(migrationsDir)) {
    return []
  }
  
  const files = readdirSync(migrationsDir)
    .filter(f => f.match(/^\d{4}_.*\.ts$/))
    .sort()
  
  const migrations = []
  
  for (const file of files) {
    const filePath = join(migrationsDir, file)
    const fileUrl = pathToFileURL(resolve(filePath)).href
    
    try {
      const module = await import(fileUrl)
      const migration = module.migration || module.default
      
      if (migration && typeof migration.up === 'function' && typeof migration.down === 'function') {
        migrations.push({
          version: migration.version,
          name: migration.name,
          up: migration.up,
          down: migration.down,
        })
      }
    } catch (err) {
      console.warn(`Warning: Could not load migration ${file}: ${toError(err).message}`)
    }
  }
  
  return migrations.sort((a, b) => b.version - a.version) // Descending for rollback
}

/**
 * Mock schema builder for dry-run
 */
function createMockSchemaBuilder(): {
  builder: SchemaBuilder
  operations: string[]
} {
  const operations: string[] = []
  
  const builder: SchemaBuilder = {
    addColumn(table: string, column: string, options?: { default?: unknown; type?: string }) {
      operations.push(`addColumn: ${table}.${column}${options?.default !== undefined ? ` (default: ${options.default})` : ''}`)
    },
    removeColumn(table: string, column: string) {
      operations.push(`removeColumn: ${table}.${column}`)
    },
    renameColumn(table: string, oldName: string, newName: string) {
      operations.push(`renameColumn: ${table}.${oldName} → ${newName}`)
    },
  }
  
  return { builder, operations }
}

// =============================================================================
// Rollback Logic
// =============================================================================

/**
 * Run the rollback command
 */
export async function runRollback(options: RollbackOptions): Promise<RollbackResult> {
  // Get migrations directory
  const config = loadConfig()
  const migrationsDir = resolve(process.cwd(), options.dir || config?.migrationsDir || 'migrations')
  
  // Load migrations (sorted descending for rollback)
  const migrations = await loadMigrations(migrationsDir)
  
  if (migrations.length === 0) {
    return {
      success: true,
      rolledBack: [],
      currentVersion: 0,
      error: 'No migrations found.',
    }
  }
  
  // CLI can only preview rollbacks (no access to actual Google Sheets).
  // Actual rollback execution happens in GAS runtime (see #26).
  const rolledBack: { version: number; name: string }[] = []
  const steps = options.all ? migrations.length : (options.steps || 1)

  for (let i = 0; i < steps && i < migrations.length; i++) {
    const migration = migrations[i]

    const { builder, operations } = createMockSchemaBuilder()
    await migration.down(builder)

    console.log(`   [${migration.version}] ${migration.name}`)
    for (const op of operations) {
      console.log(`       - ${op}`)
    }

    rolledBack.push({ version: migration.version, name: migration.name })
  }
  
  const currentVersion = migrations.length > steps 
    ? migrations[steps].version 
    : 0
  
  return {
    success: true,
    rolledBack,
    currentVersion,
  }
}

// =============================================================================
// CLI Command
// =============================================================================

export const rollbackCommand = new Command('rollback')
  .description('Preview migration rollback (actual execution happens in GAS runtime)')
  .option('-d, --dir <path>', 'Migrations directory (default: from config or "migrations")')
  .option('-a, --all', 'Rollback all migrations')
  .option('-s, --steps <number>', 'Number of migrations to rollback', (val) => parseInt(val, 10))
  .action(async (options: RollbackOptions) => {
    console.log('[PREVIEW] Scanning rollback plan...')
    console.log('')

    const result = await runRollback(options)

    if (!result.success) {
      console.error(`Error: ${result.error}`)
      process.exit(1)
    }

    if (result.rolledBack.length === 0) {
      console.log('No migrations to rollback.')
      return
    }

    console.log('')
    console.log(`Current version: ${result.currentVersion}`)
    console.log(`Total: ${result.rolledBack.length} migration(s) to rollback`)
    console.log('')
    console.log('Note: CLI only previews rollbacks. Actual execution happens in GAS runtime.')
  })
