/**
 * Client Package Generator tests
 */

import { describe, it, expect } from 'vitest'
import {
  generateClientPackage,
  generateClientTypes,
  generateClientCode,
  generateClientIndex
} from '../../src/generator/client-package-generator.js'
import type { SchemaAST } from '../../src/parser/types.js'

// =============================================================================
// Test Fixtures
// =============================================================================

const simpleSchema: SchemaAST = {
  enums: {},
  tables: {
    User: {
      name: 'User',
      fields: [
        { name: 'id', type: 'number', optional: false, attributes: [] },
        { name: 'name', type: 'string', optional: false, attributes: [] },
        { name: 'email', type: 'string', optional: false, attributes: [] },
        { name: 'age', type: 'number', optional: true, attributes: [] },
      ],
      blockAttributes: [],
    },
  },
}

const schemaWithEnum: SchemaAST = {
  enums: {
    Role: { name: 'Role', values: ['USER', 'ADMIN'] },
  },
  tables: {
    User: {
      name: 'User',
      fields: [
        { name: 'id', type: 'number', optional: false, attributes: [] },
        { name: 'name', type: 'string', optional: false, attributes: [] },
        { name: 'role', type: 'Role', optional: false, attributes: [] },
      ],
      blockAttributes: [],
    },
  },
}

const schemaWithMapping: SchemaAST = {
  enums: {},
  tables: {
    User: {
      name: 'User',
      mapTo: 'users_sheet',
      fields: [
        { name: 'id', type: 'number', optional: false, attributes: [] },
        { name: 'name', type: 'string', optional: false, attributes: [] },
      ],
      blockAttributes: [],
    },
  },
}

// =============================================================================
// Tests
// =============================================================================

describe('generateClientTypes', () => {
  it('generates types with RowWithId import', () => {
    const result = generateClientTypes(simpleSchema)

    expect(result).toContain("import type { RowWithId } from '@gsquery/core'")
  })

  it('generates interface extending RowWithId', () => {
    const result = generateClientTypes(simpleSchema)

    expect(result).toContain('export interface User extends RowWithId {')
    expect(result).toContain('id: number')
    expect(result).toContain('name: string')
    expect(result).toContain('email: string')
    expect(result).toContain('age?: number')
  })

  it('generates Tables type', () => {
    const result = generateClientTypes(simpleSchema)

    expect(result).toContain('export type Tables = {')
    expect(result).toContain('User: User')
  })

  it('generates enum types', () => {
    const result = generateClientTypes(schemaWithEnum)

    expect(result).toContain("export type Role = 'USER' | 'ADMIN'")
  })
})

describe('generateClientCode', () => {
  it('imports from @gsquery/client', () => {
    const result = generateClientCode(simpleSchema)

    expect(result).toContain("import { createClientFactory, type GeneratedSchema } from '@gsquery/client'")
  })

  it('generates schema constant', () => {
    const result = generateClientCode(simpleSchema)

    expect(result).toContain('export const schema: GeneratedSchema = {')
    expect(result).toContain('User: { columns: [')
    expect(result).toContain("'id', 'name', 'email', 'age'")
  })

  it('includes sheetName mapping', () => {
    const result = generateClientCode(schemaWithMapping)

    expect(result).toContain("sheetName: 'users_sheet'")
  })

  it('exports createClient function', () => {
    const result = generateClientCode(simpleSchema)

    expect(result).toContain('export const createClient = createClientFactory<Tables>(schema)')
  })

  it('exports createTestClient function', () => {
    const result = generateClientCode(simpleSchema)

    expect(result).toContain('export function createTestClient()')
    expect(result).toContain('return createClient({ mock: true })')
  })
})

describe('generateClientIndex', () => {
  it('re-exports types and client', () => {
    const result = generateClientIndex()

    expect(result).toContain("export * from './types.js'")
    expect(result).toContain("export * from './client.js'")
  })

  it('re-exports core types', () => {
    const result = generateClientIndex()

    expect(result).toContain("export type { SheetsDB, TableHandle, RowWithId, DataStore } from '@gsquery/core'")
  })
})

// =============================================================================
// @relation Type Aliases (Issue #76)
// =============================================================================

const schemaWithRelation: SchemaAST = {
  enums: {},
  tables: {
    User: {
      name: 'User',
      fields: [
        { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
        { name: 'name', type: 'string', optional: false, attributes: [] },
      ],
      blockAttributes: [],
    },
    Task: {
      name: 'Task',
      fields: [
        { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
        { name: 'title', type: 'string', optional: false, attributes: [] },
        { name: 'assigneeId', type: 'string', optional: true, attributes: [{ name: 'relation', args: ['User'] }] },
      ],
      blockAttributes: [],
    },
  },
}

describe('generateClientTypes @relation', () => {
  it('generates type alias for relation target', () => {
    const result = generateClientTypes(schemaWithRelation)

    expect(result).toContain("export type UserId = User['id']")
  })

  it('replaces field type with relation alias', () => {
    const result = generateClientTypes(schemaWithRelation)

    expect(result).toContain('assigneeId?: UserId')
  })

  it('handles array relation field', () => {
    const schema: SchemaAST = {
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
        Team: {
          name: 'Team',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'memberIds', type: 'string[]', optional: false, attributes: [{ name: 'relation', args: ['User'] }] },
          ],
          blockAttributes: [],
        },
      },
    }
    const result = generateClientTypes(schema)

    expect(result).toContain('memberIds: UserId[]')
  })

  it('does not generate duplicate aliases', () => {
    const schema: SchemaAST = {
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'assigneeId', type: 'string', optional: true, attributes: [{ name: 'relation', args: ['User'] }] },
            { name: 'creatorId', type: 'string', optional: false, attributes: [{ name: 'relation', args: ['User'] }] },
          ],
          blockAttributes: [],
        },
      },
    }
    const result = generateClientTypes(schema)

    const matches = result.match(/export type UserId/g)
    expect(matches).toHaveLength(1)
  })
})

describe('generateClientPackage (all files)', () => {
  it('returns all three files', () => {
    const files = generateClientPackage(simpleSchema)

    expect(files['types.ts']).toBeDefined()
    expect(files['client.ts']).toBeDefined()
    expect(files['index.ts']).toBeDefined()
  })

  it('all files have auto-generated header', () => {
    const files = generateClientPackage(simpleSchema)

    expect(files['types.ts']).toContain('Auto-generated by gsquery - DO NOT EDIT')
    expect(files['client.ts']).toContain('Auto-generated by gsquery - DO NOT EDIT')
    expect(files['index.ts']).toContain('Auto-generated by gsquery - DO NOT EDIT')
  })
})
