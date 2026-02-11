/**
 * Tests for migration:create command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runMigrationCreate } from '../../src/commands/migration-create.js'

describe('migration:create command', () => {
  let tempDir: string
  let originalCwd: string
  
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-migration-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })
  
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })
  
  it('should create migration file with version 0001', () => {
    const result = runMigrationCreate('add_users_table', {})
    
    expect(result.success).toBe(true)
    expect(result.version).toBe(1)
    expect(existsSync('migrations/0001_add_users_table.ts')).toBe(true)
  })
  
  it('should increment version for subsequent migrations', () => {
    runMigrationCreate('first', {})
    runMigrationCreate('second', {})
    const result = runMigrationCreate('third', {})
    
    expect(result.version).toBe(3)
    expect(existsSync('migrations/0003_third.ts')).toBe(true)
  })
  
  it('should convert camelCase to snake_case', () => {
    const result = runMigrationCreate('addRoleToUsers', {})
    
    expect(result.success).toBe(true)
    expect(existsSync('migrations/0001_add_role_to_users.ts')).toBe(true)
  })
  
  it('should use custom directory', () => {
    const result = runMigrationCreate('test', { dir: 'db/migrations' })
    
    expect(result.success).toBe(true)
    expect(existsSync('db/migrations/0001_test.ts')).toBe(true)
  })
  
  it('should read directory from config', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      migrationsDir: 'custom_migrations',
    }))
    
    const result = runMigrationCreate('test', {})
    
    expect(result.success).toBe(true)
    expect(existsSync('custom_migrations/0001_test.ts')).toBe(true)
  })
  
  it('should generate valid migration content', () => {
    runMigrationCreate('add_role', {})

    const content = readFileSync('migrations/0001_add_role.ts', 'utf-8')

    expect(content).toContain('version: 1')
    expect(content).toContain("name: 'add_role'")
    expect(content).toContain('async up(db: SchemaBuilder)')
    expect(content).toContain('async down(db: SchemaBuilder)')
    expect(content).toContain('export const migration')
    expect(content).toContain('export default migration')
  })

  it('should convert names with hyphens to snake_case', () => {
    const result = runMigrationCreate('add-role-to-users', {})

    expect(result.success).toBe(true)
    expect(existsSync('migrations/0001_add_role_to_users.ts')).toBe(true)
  })

  it('should convert names with spaces to snake_case', () => {
    const result = runMigrationCreate('add role to users', {})

    expect(result.success).toBe(true)
    expect(existsSync('migrations/0001_add_role_to_users.ts')).toBe(true)
  })

  it('should handle version gap in existing migrations', () => {
    // Create migrations with a gap (1 and 5)
    runMigrationCreate('first', {})
    // Manually create a migration with version 5
    writeFileSync('migrations/0005_fifth.ts', 'export default {}')

    const result = runMigrationCreate('sixth', {})

    expect(result.success).toBe(true)
    expect(result.version).toBe(6)
  })

  it('should include creation timestamp in content', () => {
    runMigrationCreate('test_migration', {})

    const content = readFileSync('migrations/0001_test_migration.ts', 'utf-8')
    expect(content).toContain('Created:')
  })

  it('should include @gsquery/core import', () => {
    runMigrationCreate('test', {})

    const content = readFileSync('migrations/0001_test.ts', 'utf-8')
    expect(content).toContain("import type { Migration, SchemaBuilder } from '@gsquery/core'")
  })

  // ==========================================================================
  // Name Validation (Issue #41)
  // ==========================================================================

  it('should reject empty name', () => {
    const result = runMigrationCreate('', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('empty')
  })

  it('should reject whitespace-only name', () => {
    const result = runMigrationCreate('   ', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('empty')
  })

  it('should reject name with control characters', () => {
    const result = runMigrationCreate('add\x00table', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('control characters')
  })

  it('should reject name with */ sequence', () => {
    const result = runMigrationCreate('close_comment_*/', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain("'*/'")
  })

  it('should reject name exceeding 128 characters', () => {
    const longName = 'a'.repeat(129)
    const result = runMigrationCreate(longName, {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('128')
  })

  it('should accept name with exactly 128 characters', () => {
    const name = 'a'.repeat(128)
    const result = runMigrationCreate(name, {})
    expect(result.success).toBe(true)
  })

  it('should escape single quotes in migration name', () => {
    const result = runMigrationCreate("it's_a_test", {})
    expect(result.success).toBe(true)

    const content = readFileSync(result.filePath!, 'utf-8')
    expect(content).toContain("name: 'it\\'s_a_test'")
  })
})
