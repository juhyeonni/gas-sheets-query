/**
 * Tests for init command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runInit } from '../../src/commands/init.js'

describe('init command', () => {
  let tempDir: string
  let originalCwd: string
  
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-init-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })
  
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })
  
  it('should create config file with default values', () => {
    const result = runInit({})
    
    expect(result.success).toBe(true)
    expect(existsSync('gsquery.config.json')).toBe(true)
    
    const config = JSON.parse(readFileSync('gsquery.config.json', 'utf-8'))
    expect(config.spreadsheetId).toBe('')
    expect(config.migrationsDir).toBe('migrations')
    expect(config.generatedDir).toBe('generated')
    expect(config.schemaFile).toBe('schema.gsq.yaml')
  })
  
  it('should create config file with provided spreadsheet ID', () => {
    const result = runInit({ spreadsheetId: 'abc123' })
    
    expect(result.success).toBe(true)
    
    const config = JSON.parse(readFileSync('gsquery.config.json', 'utf-8'))
    expect(config.spreadsheetId).toBe('abc123')
  })
  
  it('should fail if config already exists', () => {
    runInit({})
    const result = runInit({})
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })
  
  it('should overwrite config with --force', () => {
    runInit({ spreadsheetId: 'old' })
    const result = runInit({ spreadsheetId: 'new', force: true })
    
    expect(result.success).toBe(true)
    
    const config = JSON.parse(readFileSync('gsquery.config.json', 'utf-8'))
    expect(config.spreadsheetId).toBe('new')
  })
})
