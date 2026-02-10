/**
 * Init command - initialize gsquery configuration
 * 
 * Issue #12
 */

import { Command } from 'commander'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { toError } from '../utils/errors.js'

// =============================================================================
// Types
// =============================================================================

export interface InitOptions {
  spreadsheetId?: string
  force?: boolean
}

export interface GSQConfig {
  spreadsheetId: string
  migrationsDir: string
  generatedDir: string
  schemaFile: string
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: Omit<GSQConfig, 'spreadsheetId'> = {
  migrationsDir: 'migrations',
  generatedDir: 'generated',
  schemaFile: 'schema.gsq.yaml',
}

const CONFIG_FILENAME = 'gsquery.config.json'

// =============================================================================
// Init Logic
// =============================================================================

export interface InitResult {
  success: boolean
  configPath: string
  error?: string
}

/**
 * Run the init command
 */
export function runInit(options: InitOptions): InitResult {
  const configPath = resolve(process.cwd(), CONFIG_FILENAME)
  
  // Check if config already exists
  if (existsSync(configPath) && !options.force) {
    return {
      success: false,
      configPath,
      error: `Config file already exists: ${CONFIG_FILENAME}. Use --force to overwrite.`,
    }
  }
  
  // Build config
  const config: GSQConfig = {
    spreadsheetId: options.spreadsheetId || '',
    ...DEFAULT_CONFIG,
  }
  
  // Write config file
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return {
      success: true,
      configPath,
    }
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to write config: ${toError(err).message}`,
    }
  }
}

/**
 * Load existing config file
 */
export function loadConfig(): GSQConfig | null {
  const configPath = resolve(process.cwd(), CONFIG_FILENAME)
  
  if (!existsSync(configPath)) {
    return null
  }
  
  try {
    const content = JSON.parse(readFileSync(configPath, 'utf-8'))
    return content as GSQConfig
  } catch {
    return null
  }
}

// =============================================================================
// CLI Command
// =============================================================================

export const initCommand = new Command('init')
  .description('Initialize gsquery configuration file')
  .option('-s, --spreadsheet-id <id>', 'Google Spreadsheet ID')
  .option('-f, --force', 'Overwrite existing config file')
  .action((options: InitOptions) => {
    console.log('🔧 Initializing gsquery configuration...')
    console.log('')
    
    const result = runInit(options)
    
    if (!result.success) {
      console.error(`❌ ${result.error}`)
      process.exit(1)
    }
    
    console.log(`✅ Created ${CONFIG_FILENAME}`)
    console.log('')
    
    if (!options.spreadsheetId) {
      console.log('⚠️  Note: No spreadsheet ID provided.')
      console.log(`   Edit ${CONFIG_FILENAME} to add your spreadsheet ID.`)
      console.log('')
    }
    
    console.log('📝 Next steps:')
    console.log('   1. Create your schema file: schema.gsq.yaml')
    console.log('   2. Generate types: gsquery generate')
    console.log('   3. Create migrations: gsquery migration:create <name>')
    console.log('')
    console.log('🎉 Done!')
  })
