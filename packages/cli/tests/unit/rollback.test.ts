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
    tempDir = mkdtempSync(join(tmpdir(), 'gsq-rollback-test-'))
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
    
    const result = await runRollback({ dryRun: true })
    
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
    
    const result = await runRollback({ steps: 2, dryRun: true })
    
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
    
    const result = await runRollback({ all: true, dryRun: true })
    
    expect(result.success).toBe(true)
    expect(result.rolledBack).toHaveLength(2)
    expect(result.currentVersion).toBe(0)
  })
})
