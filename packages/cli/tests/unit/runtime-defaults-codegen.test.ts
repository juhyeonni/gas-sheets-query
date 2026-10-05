/**
 * #199 — `generate --client` emits `@default` / `@updatedAt` into the runtime
 * schema and makes those fields optional in a per-table create input. The
 * default `generate` path (without `--client`) is unchanged.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULTS_SCHEMA_YAML, parseFixture as parse } from '../helpers/runtime-defaults-schema.js'
import {
  generateClientCode,
  generateClientTypes
} from '../../src/generator/client-package-generator.js'
import { generateTypes } from '../../src/generator/types-generator.js'
import { generateClient } from '../../src/generator/client-generator.js'
import type { SchemaAST } from '../../src/parser/types.js'

/** Same schema with every field attribute except @id removed */
function stripAttributes(ast: SchemaAST): SchemaAST {
  return {
    enums: ast.enums,
    tables: Object.fromEntries(
      Object.entries(ast.tables).map(([name, table]) => [
        name,
        {
          ...table,
          fields: table.fields.map(f => ({ ...f, attributes: f.attributes.filter(a => a.name === 'id') }))
        }
      ])
    )
  }
}

/** The `{ ... }` literal emitted for one table in the generated schema constant */
function tableLiteral(code: string, table: string): string {
  const line = code.split('\n').find(l => l.trimStart().startsWith(`${table}: {`))
  if (!line) throw new Error(`table ${table} not found in generated schema`)
  return line
}

/** The body of one generated interface, one trimmed line per field */
function interfaceBody(code: string, name: string): string[] {
  const start = code.indexOf(`export interface ${name} `)
  if (start === -1) throw new Error(`interface ${name} not found`)
  const end = code.indexOf('\n}', start)
  return code
    .slice(start, end)
    .split('\n')
    .slice(1)
    .map(l => l.trim())
}

describe('generate --client runtime schema (#199)', () => {
  const ast = parse(DEFAULTS_SCHEMA_YAML)
  const code = generateClientCode(ast)

  it('AC10: emits literal and `now` defaults per table', () => {
    const task = tableLiteral(code, 'Task')
    expect(task).toContain(
      "defaults: { 'status': { kind: 'value', value: 'to-do' }, " +
      "'priority': { kind: 'value', value: 3 }, " +
      "'done': { kind: 'value', value: false }, " +
      "'role': { kind: 'value', value: 'USER' }, " +
      "'createdAt': { kind: 'now' } }"
    )
  })

  it('AC10: emits the @updatedAt field list', () => {
    expect(tableLiteral(code, 'Task')).toContain("updatedAt: ['updatedAt']")
    expect(tableLiteral(code, 'Setting')).toContain("updatedAt: ['touchedAt']")
  })

  it('AC10: emits nothing for autoincrement, uuid or cuid, and nothing for id', () => {
    const literal = tableLiteral(code, 'Task')
    // Only the part after the column list: every field is still a column
    const task = literal.slice(literal.indexOf('defaults:'))
    expect(task).toContain("'createdAt': { kind: 'now' }")
    expect(task).not.toContain("'token'")
    expect(task).not.toContain("'slug'")
    expect(task).not.toContain("'seq': {")
    expect(task).not.toContain("'id': {")
    expect(task).not.toContain('autoincrement')
    expect(task).not.toContain('uuid')
    expect(task).not.toContain('cuid')

    const setting = tableLiteral(code, 'Setting')
    expect(setting).not.toContain('defaults:')
    expect(setting).not.toContain("'main-1'")
  })

  it('AC10: a table without defaults or @updatedAt gets neither key', () => {
    const plain = tableLiteral(code, 'Plain')
    expect(plain).not.toContain('defaults:')
    expect(plain).not.toContain('updatedAt:')
  })

  it('AC10: escapes string literal defaults', () => {
    const quoted = parse(`
tables:
  Q:
    fields:
      id: number @id
      label: string @default("it's")
`)
    expect(generateClientCode(quoted)).toContain("defaults: { 'label': { kind: 'value', value: 'it\\'s' } }")
  })

  it('passes the per-table create inputs to the client factory', () => {
    expect(code).toContain("import type { Tables, CreateInputs } from './types.js'")
    expect(code).toContain('export const createClient = createClientFactory<Tables, CreateInputs>(schema)')
  })
})

describe('generate --client create input types (#199)', () => {
  const ast = parse(DEFAULTS_SCHEMA_YAML)
  const types = generateClientTypes(ast)

  it('AC11: exports <Table>CreateInput with defaulted and @updatedAt fields optional', () => {
    expect(interfaceBody(types, 'TaskCreateInput')).toEqual([
      'id?: number',
      'title: string',
      'status?: string',
      'priority?: number',
      'done?: boolean',
      'role?: Role',
      'token: string',
      'slug: string',
      'seq: number',
      'note?: string',
      'createdAt?: Date',
      'updatedAt?: Date'
    ])
    expect(interfaceBody(types, 'SettingCreateInput')).toEqual([
      'id?: string',
      'value: string',
      'touchedAt?: Date'
    ])
    expect(interfaceBody(types, 'PlainCreateInput')).toEqual(['id?: number', 'label: string'])
  })

  it('AC11: the row interface is unchanged', () => {
    const stripped = generateClientTypes(stripAttributes(ast))
    expect(interfaceBody(types, 'Task')).toEqual(interfaceBody(stripped, 'Task'))
    expect(interfaceBody(types, 'Task')).toEqual([
      'id: number',
      'title: string',
      'status: string',
      'priority: number',
      'done: boolean',
      'role: Role',
      'token: string',
      'slug: string',
      'seq: number',
      'note?: string',
      'createdAt: Date',
      'updatedAt: Date'
    ])
    expect(types).toContain('export interface Task extends RowWithId {')
  })

  it('AC11: exports a CreateInputs map next to Tables', () => {
    expect(types).toContain(
      'export type CreateInputs = {\n' +
      '  Plain: PlainCreateInput\n' +
      '  Setting: SettingCreateInput\n' +
      '  Task: TaskCreateInput\n' +
      '}'
    )
  })

  it('AC11: keeps relation aliases in the create input', () => {
    const rel = parse(`
tables:
  User:
    fields:
      id: string @id
  Post:
    fields:
      id: string @id
      authorId: string @relation(User)
      createdAt: datetime @default(now)
`)
    expect(interfaceBody(generateClientTypes(rel), 'PostCreateInput')).toEqual([
      'id?: string',
      'authorId: UserId',
      'createdAt?: Date'
    ])
  })
})

describe('generate without --client is unchanged (#199)', () => {
  const ast = parse(DEFAULTS_SCHEMA_YAML)
  const stripped = stripAttributes(ast)

  it('AC13: types.ts does not depend on @default / @updatedAt', () => {
    const out = generateTypes(ast)
    expect(out).toBe(generateTypes(stripped))
    expect(out).not.toContain('CreateInput')
  })

  it('AC13: client.ts does not depend on @default / @updatedAt', () => {
    const out = generateClient(ast)
    expect(out).toBe(generateClient(stripped))
    expect(out).not.toContain('defaults')
    expect(out).not.toContain('updatedAt:')
    expect(out).toContain('return createSheetsDB<Tables>({')
  })
})
