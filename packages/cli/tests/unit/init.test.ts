/**
 * Tests for init command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runInit, loadConfig } from '../../src/commands/init.js'

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

describe('loadConfig', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-loadconfig-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })

  it('should return null when no config file exists', () => {
    const config = loadConfig()
    expect(config).toBeNull()
  })

  it('should load valid config file', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      spreadsheetId: 'abc123',
      migrationsDir: 'migrations',
      generatedDir: 'generated',
      schemaFile: 'schema.gsq.yaml'
    }))

    const config = loadConfig()
    expect(config).not.toBeNull()
    expect(config!.spreadsheetId).toBe('abc123')
    expect(config!.migrationsDir).toBe('migrations')
  })

  it('should throw on invalid JSON', () => {
    writeFileSync('gsquery.config.json', 'not valid json {{{')

    expect(() => loadConfig()).toThrow('Failed to parse gsquery.config.json')
  })

  it('should not throw on array config (typeof array is object)', () => {
    writeFileSync('gsquery.config.json', '[]')

    // Arrays pass the typeof check since typeof [] === 'object'
    const config = loadConfig()
    expect(config).not.toBeNull()
  })

  it('should throw on non-object config (string)', () => {
    writeFileSync('gsquery.config.json', '"just a string"')

    expect(() => loadConfig()).toThrow('Invalid config: expected object')
  })

  it('should throw on non-object config (null)', () => {
    writeFileSync('gsquery.config.json', 'null')

    expect(() => loadConfig()).toThrow('Invalid config: expected object')
  })

  it('should throw when field has wrong type', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      spreadsheetId: 123  // should be string
    }))

    expect(() => loadConfig()).toThrow("field 'spreadsheetId' must be a string")
  })

  it('should throw when migrationsDir has wrong type', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      spreadsheetId: 'abc',
      migrationsDir: false  // should be string
    }))

    expect(() => loadConfig()).toThrow("field 'migrationsDir' must be a string")
  })

  it('should accept config with partial fields', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      spreadsheetId: 'abc123'
    }))

    const config = loadConfig()
    expect(config).not.toBeNull()
    expect(config!.spreadsheetId).toBe('abc123')
  })

  it('should accept config with extra fields', () => {
    writeFileSync('gsquery.config.json', JSON.stringify({
      spreadsheetId: 'abc',
      customField: 'extra'
    }))

    const config = loadConfig()
    expect(config).not.toBeNull()
    expect(config!.spreadsheetId).toBe('abc')
  })
})
