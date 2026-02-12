/**
 * Rollback command - rollback the last migration
 * 
 * Issue #12
 */

import { Command } from 'commander'
import { resolve } from 'path'
import { loadConfig } from './init.js'
import { loadMigrations, createMockSchemaBuilder } from './migration-utils.js'

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
  const migrations = await loadMigrations(migrationsDir, 'desc')
  
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
  .option('-s, --steps <number>', 'Number of migrations to rollback', (val) => {
    const num = parseInt(val, 10)
    if (isNaN(num)) {
      throw new Error(`Invalid steps number: '${val}'. Expected a number.`)
    }
    return num
  })
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
