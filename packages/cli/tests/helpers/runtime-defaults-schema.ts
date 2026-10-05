/**
 * Shared fixture for the #199 codegen tests: one table per kind of default.
 */
import { parseSchema } from '../../src/parser/schema-parser.js'
import type { SchemaAST } from '../../src/parser/types.js'

export const DEFAULTS_SCHEMA_YAML = `
enums:
  Role:
    - USER
    - ADMIN

tables:
  Task:
    fields:
      id: number @id @default(autoincrement)
      title: string
      status: string @default("to-do")
      priority: number @default(3)
      done: boolean @default(false)
      role: Role @default(USER)
      token: string @default(uuid)
      slug: string @default(cuid)
      seq: number @default(autoincrement)
      note: string?
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt
  Setting:
    fields:
      id: string @id @default("main-1")
      value: string
      touchedAt: datetime @updatedAt
  Plain:
    fields:
      id: number @id
      label: string
`

/** Parse a schema fixture, failing loudly when it does not parse */
export function parseFixture(yaml: string): SchemaAST {
  const result = parseSchema(yaml)
  if (!result.success || !result.schema) {
    throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  }
  return result.schema
}
