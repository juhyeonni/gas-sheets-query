/**
 * Tests for migrate command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runMigrate } from '../../src/commands/migrate.js'

describe('migrate command', () => {
  let tempDir: string
  let originalCwd: string
  
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-migrate-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })
  
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })
  
  it('should return empty when no migrations directory', async () => {
    const result = await runMigrate({})
    
    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(0)
    expect(result.error).toBe('No migrations found.')
  })
  
  it('should return empty when no migration files', async () => {
    mkdirSync('migrations')
    
    const result = await runMigrate({})
    
    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(0)
  })
  
  it('should detect migration files', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0001_test.ts', `
      export const migration = {
        version: 1,
        name: 'test',
        up: () => {},
        down: () => {},
      }
    `)
    
    const result = await runMigrate({})

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].version).toBe(1)
    expect(result.applied[0].name).toBe('test')
  })

  it('should respect --to option', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0001_first.ts', `
      export const migration = {
        version: 1,
        name: 'first',
        up: () => {},
        down: () => {},
      }
    `)
    writeFileSync('migrations/0002_second.ts', `
      export const migration = {
        version: 2,
        name: 'second',
        up: () => {},
        down: () => {},
      }
    `)
    writeFileSync('migrations/0003_third.ts', `
      export const migration = {
        version: 3,
        name: 'third',
        up: () => {},
        down: () => {},
      }
    `)
    
    const result = await runMigrate({ to: 2 })
    
    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(2)
    expect(result.currentVersion).toBe(2)
  })
  
  it('should use custom directory', async () => {
    mkdirSync('db/migrations', { recursive: true })
    writeFileSync('db/migrations/0001_test.ts', `
      export const migration = {
        version: 1,
        name: 'test',
        up: () => {},
        down: () => {},
      }
    `)

    const result = await runMigrate({ dir: 'db/migrations' })

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
  })

  it('should execute schema builder operations in up()', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0001_add_role.ts', `
      export const migration = {
        version: 1,
        name: 'add_role',
        up: (db) => {
          db.addColumn('users', 'role', { default: 'user', type: 'string' })
        },
        down: (db) => {
          db.removeColumn('users', 'role')
        },
      }
    `)

    const result = await runMigrate({})

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].name).toBe('add_role')
  })

  it('should skip non-migration files', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/README.md', '# Migrations')
    writeFileSync('migrations/0001_test.ts', `
      export const migration = {
        version: 1,
        name: 'test',
        up: () => {},
        down: () => {},
      }
    `)

    const result = await runMigrate({})

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
  })

  it('should read directory from config file', async () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      migrationsDir: 'custom_migrations',
    }))
    mkdirSync('custom_migrations')
    writeFileSync('custom_migrations/0001_test.ts', `
      export const migration = {
        version: 1,
        name: 'test',
        up: () => {},
        down: () => {},
      }
    `)

    const result = await runMigrate({})

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
  })

  it('should sort migrations by version', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0003_third.ts', `
      export const migration = {
        version: 3,
        name: 'third',
        up: () => {},
        down: () => {},
      }
    `)
    writeFileSync('migrations/0001_first.ts', `
      export const migration = {
        version: 1,
        name: 'first',
        up: () => {},
        down: () => {},
      }
    `)
    writeFileSync('migrations/0002_second.ts', `
      export const migration = {
        version: 2,
        name: 'second',
        up: () => {},
        down: () => {},
      }
    `)

    const result = await runMigrate({})

    expect(result.applied[0].version).toBe(1)
    expect(result.applied[1].version).toBe(2)
    expect(result.applied[2].version).toBe(3)
    expect(result.currentVersion).toBe(3)
  })

  it('should handle migration with default export', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0001_test.ts', `
      const migration = {
        version: 1,
        name: 'test_default',
        up: () => {},
        down: () => {},
      }
      export default migration
    `)

    const result = await runMigrate({})

    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].name).toBe('test_default')
  })
})
