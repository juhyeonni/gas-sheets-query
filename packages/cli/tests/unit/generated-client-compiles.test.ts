/**
 * The generated client compiles against @gsquery/core (#246).
 *
 * `createSheetsDB<Tables>` checks each table's column list against its row
 * type, so the `as const` schema `gsquery generate` emits in client.ts has to
 * agree with the interfaces it emits in types.ts. This runs the generators on a
 * schema and compiles their real output with the TypeScript compiler against
 * core's sources; Vitest alone strips types and would prove nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import { parseSchema } from '../../src/parser/schema-parser.js'
import { generateTypes } from '../../src/generator/types-generator.js'
import { generateClient } from '../../src/generator/client-generator.js'
import type { SchemaAST } from '../../src/parser/types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE_DIR = resolve(HERE, '../../../core')

const SCHEMA = `
enums:
  Role:
    - USER
    - ADMIN

tables:
  User:
    fields:
      id: number @id
      email: string @unique
      name: string?
      role: Role
      tags: string[]?
    map: Users
  Post:
    fields:
      id: number @id
      title: string
      authorId: number
      publishedAt: datetime?
    indexes:
      - [authorId]
`

/** Caller code that uses the generated client the way the docs show. */
const USAGE = `
import { createTestDB } from './client.js'

const db = createTestDB()
const user = db.from('User').create({ email: 'a@example.com', role: 'USER' })
const posts = db.from('Post').query().where('authorId', '=', user.id).exec()
export const titles: string[] = posts.map(p => p.title)
`

let dir: string

function writeGenerated(ast: SchemaAST, clientOverride?: (client: string) => string): void {
  const client = generateClient(ast)
  writeFileSync(join(dir, 'types.ts'), generateTypes(ast), 'utf-8')
  writeFileSync(join(dir, 'client.ts'), clientOverride ? clientOverride(client) : client, 'utf-8')
  writeFileSync(join(dir, 'usage.ts'), USAGE, 'utf-8')
}

/** Compile the generated files with core's strict settings; return the error messages. */
function compile(): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    baseUrl: dir,
    paths: { '@gsquery/core': [join(CORE_DIR, 'src/index.ts')] },
    typeRoots: [join(CORE_DIR, 'node_modules/@types')],
    types: ['node', 'google-apps-script'],
  }
  const program = ts.createProgram(
    ['types.ts', 'client.ts', 'usage.ts'].map(f => join(dir, f)),
    options
  )
  return ts
    .getPreEmitDiagnostics(program)
    .map(d => {
      const where = d.file ? `${d.file.fileName}: ` : ''
      return where + ts.flattenDiagnosticMessageText(d.messageText, '\n')
    })
}

function parse(): SchemaAST {
  const result = parseSchema(SCHEMA)
  if (!result.success || !result.schema) {
    throw new Error(`fixture schema did not parse: ${JSON.stringify(result.errors)}`)
  }
  return result.schema
}

describe('generated client against typed column lists', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsquery-generated-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('compiles: the emitted schema tuples match the emitted row interfaces (AC7)', () => {
    writeGenerated(parse())
    expect(compile()).toEqual([])
  }, 60_000)

  it('fails to compile when a schema column is not a key of its row interface', () => {
    writeGenerated(parse(), client => client.replace("'authorId'", "'authorID'"))
    const errors = compile()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join('\n')).toContain('authorID')
  }, 60_000)
})
