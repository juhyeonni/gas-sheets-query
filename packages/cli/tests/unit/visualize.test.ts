/**
 * Tests for visualize command
 *
 * Issue #224
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runVisualize } from '../../src/commands/visualize.js'

const SCHEMA = `
tables:
  User:
    fields:
      id: number @id
  Project:
    fields:
      id: number @id
      ownerId: number @relation(User)
`

describe('visualize command', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsquery-visualize-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true })
  })

  it('should fail when the schema file is missing', () => {
    const result = runVisualize({ schema: 'schema.gsq.yaml', output: 'erd.md' })

    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain('Schema file not found')
    expect(existsSync('erd.md')).toBe(false)
  })

  it('should report parse errors instead of writing a file', () => {
    writeFileSync('schema.gsq.yaml', 'tables:\n  User:\n    fields:\n      id: nope @id\n')

    const result = runVisualize({ schema: 'schema.gsq.yaml', output: 'erd.md' })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(existsSync('erd.md')).toBe(false)
  })

  it('should write the diagram to the output path', () => {
    writeFileSync('schema.gsq.yaml', SCHEMA)

    const result = runVisualize({ schema: 'schema.gsq.yaml', output: 'erd.md' })

    expect(result.success).toBe(true)
    expect(result.file).toBe('erd.md')
    expect(result.relationCount).toBe(1)
    expect(readFileSync('erd.md', 'utf-8')).toContain('User ||--o{ Project : "ownerId"')
  })

  it('should not write a file when stdout is requested', () => {
    writeFileSync('schema.gsq.yaml', SCHEMA)

    const result = runVisualize({ schema: 'schema.gsq.yaml', output: 'erd.md', stdout: true })

    expect(result.success).toBe(true)
    expect(result.file).toBeUndefined()
    expect(result.diagram).toContain('erDiagram')
    expect(existsSync('erd.md')).toBe(false)
  })

  it('should create missing directories for the output path', () => {
    writeFileSync('schema.gsq.yaml', SCHEMA)

    const result = runVisualize({ schema: 'schema.gsq.yaml', output: join('docs', 'erd.md') })

    expect(result.success).toBe(true)
    expect(existsSync(join('docs', 'erd.md'))).toBe(true)
  })

  it('should report relationCount 0 when no @relation is declared', () => {
    writeFileSync('schema.gsq.yaml', 'tables:\n  User:\n    fields:\n      id: number @id\n')

    const result = runVisualize({ schema: 'schema.gsq.yaml', output: 'erd.md' })

    expect(result.success).toBe(true)
    expect(result.relationCount).toBe(0)
  })
})
