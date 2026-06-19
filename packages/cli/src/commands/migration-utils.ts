/**
 * Shared utilities for migrate and rollback commands
 *
 * Issue #45
 */

import { existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { pathToFileURL } from 'url'
import { toError } from '../utils/errors.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Schema builder interface for migration operations
 */
export interface SchemaBuilder {
  addColumn<T = unknown>(table: string, column: string, options?: { default?: T; type?: string }): void
  removeColumn(table: string, column: string): void
  renameColumn(table: string, oldName: string, newName: string): void
}

/**
 * Migration definition
 */
export interface MigrationDef {
  version: number
  name: string
  up: (db: SchemaBuilder) => void | Promise<void>
  down: (db: SchemaBuilder) => void | Promise<void>
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Load migration files from directory
 *
 * @param migrationsDir - Path to migrations directory
 * @param sortOrder - Sort order: 'asc' for migrate, 'desc' for rollback
 */
export async function loadMigrations(
  migrationsDir: string,
  sortOrder: 'asc' | 'desc',
): Promise<MigrationDef[]> {
  if (!existsSync(migrationsDir)) {
    return []
  }

  // Match compiled .js too: the published bin runs under plain Node, which
  // cannot import() a .ts file (ERR_UNKNOWN_FILE_EXTENSION) (#82).
  const matched = readdirSync(migrationsDir).filter(f => /^\d+_.*\.(ts|js)$/.test(f))

  // If both a .ts source and its compiled .js exist for the same migration,
  // keep only one (otherwise the runner sees a duplicate version). Prefer .js
  // since production runs under plain Node; dev with only .ts still works.
  const byBase = new Map<string, string>()
  for (const f of matched) {
    const base = f.replace(/\.(ts|js)$/, '')
    const existing = byBase.get(base)
    if (!existing || (existing.endsWith('.ts') && f.endsWith('.js'))) {
      byBase.set(base, f)
    }
  }
  const files = [...byBase.values()].sort()

  const migrations = []

  for (const file of files) {
    const filePath = join(migrationsDir, file)
    const fileUrl = pathToFileURL(resolve(filePath)).href

    try {
      // Dynamic import (ESM)
      const module = await import(fileUrl)
      const migration = module.migration || module.default

      if (migration && typeof migration.up === 'function' && typeof migration.down === 'function') {
        // Validate version and name types
        if (typeof migration.version !== 'number') {
          throw new Error(`Invalid migration: version must be a number, got ${typeof migration.version}`)
        }
        if (typeof migration.name !== 'string') {
          throw new Error(`Invalid migration: name must be a string, got ${typeof migration.name}`)
        }

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

  return sortOrder === 'asc'
    ? migrations.sort((a, b) => a.version - b.version)
    : migrations.sort((a, b) => b.version - a.version)
}

/**
 * Mock schema builder for dry-run
 */
export function createMockSchemaBuilder(): {
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
