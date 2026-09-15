/**
 * Visualize command - renders the schema as a Mermaid ER diagram
 *
 * Issue #224
 */

import { Command } from 'commander'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { parseSchema } from '../parser/schema-parser.js'
import { generateErd } from '../generator/erd-generator.js'
import { toError } from '../utils/errors.js'
import { writeFile } from '../utils/fs.js'
import { loadConfig } from './init.js'
import { DEFAULT_SCHEMA_FILE } from './generate.js'

// =============================================================================
// Constants
// =============================================================================

/** Default ERD path, relative to the working directory. */
export const DEFAULT_ERD_FILE = 'erd.md'

// =============================================================================
// Types
// =============================================================================

/** Raw options as parsed from the command line. */
export interface VisualizeCliOptions {
  schema?: string
  output?: string
  stdout?: boolean
}

/** Fully resolved options. */
export interface VisualizeOptions {
  schema: string
  output: string
  /** Return the diagram instead of writing it to `output`. */
  stdout?: boolean
}

export interface VisualizeResult {
  success: boolean
  /** The rendered markdown document, on success. */
  diagram?: string
  /** Path written to, absent when `stdout` was requested. */
  file?: string
  /** Rendered edge count. Zero means the schema declares no `@relation`. */
  relationCount: number
  errors: string[]
}

// =============================================================================
// Option Resolution
// =============================================================================

/**
 * Resolve options from CLI flags, config file, and defaults.
 *
 * Only the schema path is configurable; the ERD is a one-off artifact, so its
 * destination stays a flag.
 */
export function resolveVisualizeOptions(options: VisualizeCliOptions): VisualizeOptions {
  let configSchema: string | undefined
  try {
    configSchema = loadConfig()?.schemaFile
  } catch (err) {
    // A broken config must not block a read-only diagram.
    console.warn(`⚠️  ${toError(err).message}`)
  }

  return {
    schema: options.schema || configSchema || DEFAULT_SCHEMA_FILE,
    output: options.output || DEFAULT_ERD_FILE,
    stdout: options.stdout,
  }
}

// =============================================================================
// Visualize Logic
// =============================================================================

/**
 * Render the schema as a Mermaid ER diagram.
 *
 * Expected failures (missing file, parse errors) come back in `errors` rather
 * than as exceptions, matching the other commands.
 */
export function runVisualize(options: VisualizeOptions): VisualizeResult {
  const schemaPath = resolve(process.cwd(), options.schema)

  if (!existsSync(schemaPath)) {
    return { success: false, relationCount: 0, errors: [`Schema file not found: ${schemaPath}`] }
  }

  let content: string
  try {
    content = readFileSync(schemaPath, 'utf-8')
  } catch (err) {
    return {
      success: false,
      relationCount: 0,
      errors: [`Failed to read schema file: ${toError(err).message}`],
    }
  }

  const parsed = parseSchema(content)
  if (!parsed.success || !parsed.schema) {
    return { success: false, relationCount: 0, errors: parsed.errors.map(e => e.message) }
  }

  const { diagram, relationCount } = generateErd(parsed.schema)

  if (options.stdout) {
    return { success: true, diagram, relationCount, errors: [] }
  }

  try {
    writeFile(resolve(process.cwd(), options.output), diagram)
  } catch (err) {
    return {
      success: false,
      relationCount,
      errors: [`Failed to write ${options.output}: ${toError(err).message}`],
    }
  }

  return { success: true, diagram, file: options.output, relationCount, errors: [] }
}

// =============================================================================
// CLI Command
// =============================================================================

export const visualizeCommand = new Command('visualize')
  .description('Render the schema as a Mermaid ER diagram')
  .option('-s, --schema <path>', 'Schema file path (default: from config or "schema.gsq.yaml")')
  .option('-o, --output <path>', `Output file (default: "${DEFAULT_ERD_FILE}")`)
  .option('--stdout', 'Print the diagram instead of writing a file')
  .action((options: VisualizeCliOptions) => {
    const resolved = resolveVisualizeOptions(options)
    const result = runVisualize(resolved)

    if (!result.success) {
      console.error('❌ Visualization failed:')
      for (const error of result.errors) {
        console.error(`   ${error}`)
      }
      process.exit(1)
    }

    if (resolved.stdout) {
      // The document already ends with a newline; console.log adds its own.
      console.log(result.diagram?.trimEnd())
    } else {
      console.log(`✅ Generated ${result.file}`)
    }

    // Guidance goes to stderr so it never contaminates the diagram.
    if (result.relationCount === 0) {
      console.error(
        'ℹ️  No relationships drawn. Add @relation(Table) to your foreign key fields to see them.'
      )
    }
  })
