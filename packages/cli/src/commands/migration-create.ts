/**
 * Migration:create command - create a new migration file
 * 
 * Issue #12
 */

import { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { loadConfig } from './init.js'

// =============================================================================
// Types
// =============================================================================

export interface MigrationCreateOptions {
  dir?: string
}

export interface MigrationCreateResult {
  success: boolean
  filePath?: string
  version?: number
  error?: string
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get next migration version number
 */
function getNextVersion(migrationsDir: string): number {
  if (!existsSync(migrationsDir)) {
    return 1
  }
  
  const files = readdirSync(migrationsDir)
  const versions = files
    .filter(f => f.match(/^\d{4}_.*\.ts$/))
    .map(f => parseInt(f.split('_')[0], 10))
    .filter(v => !isNaN(v))
  
  if (versions.length === 0) {
    return 1
  }
  
  return Math.max(...versions) + 1
}

/**
 * Convert name to snake_case
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

/**
 * Generate migration file content
 */
function generateMigrationContent(version: number, name: string): string {
  return `/**
 * Migration: ${name}
 * Version: ${version}
 * Created: ${new Date().toISOString()}
 */

import type { Migration, SchemaBuilder } from '@gsquery/core'

export const migration: Migration = {
  version: ${version},
  name: '${name}',
  
  async up(db: SchemaBuilder): Promise<void> {
    // Add your schema changes here
    // Example:
    // db.addColumn('users', 'role', { default: 'user', type: 'string' })
  },
  
  async down(db: SchemaBuilder): Promise<void> {
    // Revert your schema changes here
    // Example:
    // db.removeColumn('users', 'role')
  },
}

export default migration
`
}

// =============================================================================
// Migration Create Logic
// =============================================================================

/**
 * Run the migration:create command
 */
export function runMigrationCreate(name: string, options: MigrationCreateOptions): MigrationCreateResult {
  // Get migrations directory
  const config = loadConfig()
  const migrationsDir = resolve(process.cwd(), options.dir || config?.migrationsDir || 'migrations')
  
  // Ensure directory exists
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true })
  }
  
  // Get next version
  const version = getNextVersion(migrationsDir)
  const versionStr = String(version).padStart(4, '0')
  
  // Generate filename
  const snakeName = toSnakeCase(name)
  const filename = `${versionStr}_${snakeName}.ts`
  const filePath = join(migrationsDir, filename)
  
  // Check if file already exists (shouldn't happen, but just in case)
  if (existsSync(filePath)) {
    return {
      success: false,
      error: `Migration file already exists: ${filename}`,
    }
  }
  
  // Generate and write file
  const content = generateMigrationContent(version, name)
  
  try {
    writeFileSync(filePath, content, 'utf-8')
    return {
      success: true,
      filePath,
      version,
    }
  } catch (err) {
    const error = err as Error
    return {
      success: false,
      error: `Failed to write migration file: ${error.message}`,
    }
  }
}

// =============================================================================
// CLI Command
// =============================================================================

export const migrationCreateCommand = new Command('migration:create')
  .description('Create a new migration file')
  .argument('<name>', 'Migration name (e.g., add_role_to_users)')
  .option('-d, --dir <path>', 'Migrations directory (default: from config or "migrations")')
  .action((name: string, options: MigrationCreateOptions) => {
    console.log('📝 Creating migration...')
    console.log('')
    
    const result = runMigrationCreate(name, options)
    
    if (!result.success) {
      console.error(`❌ ${result.error}`)
      process.exit(1)
    }
    
    console.log(`✅ Created migration: ${result.filePath}`)
    console.log(`   Version: ${result.version}`)
    console.log('')
    console.log('📝 Next steps:')
    console.log('   1. Edit the migration file to add your schema changes')
    console.log('   2. Run migrations: gsquery migrate')
    console.log('')
    console.log('🎉 Done!')
  })
