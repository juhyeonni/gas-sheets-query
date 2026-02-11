/**
 * Tests for rollback command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runRollback } from '../../src/commands/rollback.js'

describe('rollback command', () => {
  let tempDir: string
  let originalCwd: string
  
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-rollback-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })
  
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })
  
  it('should return empty when no migrations directory', async () => {
    const result = await runRollback({})
    
    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(0)
    expect(result.error).toBe('No migrations found.')
  })
  
  it('should rollback one migration by default', async () => {
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
    
    const result = await runRollback({ })
    
    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(1)
    expect(result.rolledBack[0].version).toBe(2)
    expect(result.rolledBack[0].name).toBe('second')
  })
  
  it('should rollback multiple with --steps', async () => {
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
    
    const result = await runRollback({ steps: 2, })
    
    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(2)
    expect(result.rolledBack[0].version).toBe(3)
    expect(result.rolledBack[1].version).toBe(2)
  })
  
  it('should rollback all with --all', async () => {
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

    const result = await runRollback({ all: true, })

    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(2)
    expect(result.currentVersion).toBe(0)
  })

  it('should return empty when no migration files in directory', async () => {
    mkdirSync('migrations')

    const result = await runRollback({})

    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(0)
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

    const result = await runRollback({ dir: 'db/migrations' })

    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(1)
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

    const result = await runRollback({})

    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(1)
  })

  it('should execute schema builder operations in down()', async () => {
    mkdirSync('migrations')
    writeFileSync('migrations/0001_add_role.ts', `
      export const migration = {
        version: 1,
        name: 'add_role',
        up: (db) => {
          db.addColumn('users', 'role', { default: 'user' })
        },
        down: (db) => {
          db.removeColumn('users', 'role')
        },
      }
    `)

    const result = await runRollback({})

    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(1)
    expect(result.rolledBack[0].name).toBe('add_role')
  })

  it('should rollback in descending version order', async () => {
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

    const result = await runRollback({ all: true })

    expect(result.rolledBack[0].version).toBe(3)
    expect(result.rolledBack[1].version).toBe(2)
    expect(result.rolledBack[2].version).toBe(1)
    expect(result.currentVersion).toBe(0)
  })
})
