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
    tempDir = mkdtempSync(join(tmpdir(), 'gsq-migrate-test-'))
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
    
    const result = await runMigrate({ dryRun: true })
    
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
    
    const result = await runMigrate({ to: 2, dryRun: true })
    
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
    
    const result = await runMigrate({ dir: 'db/migrations', dryRun: true })
    
    expect(result.success).toBe(true)
    expect(result.applied).toHaveLength(1)
  })
})
