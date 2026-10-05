/**
 * #199 AC12 — type-level check of a generated `--client` client.
 *
 * Writes the generated files plus a usage file into a temp directory and
 * compiles them with the TypeScript compiler against the core and client
 * sources. `@ts-expect-error` lines prove that a missing required field is a
 * type error (an unused directive is itself an error), and the rest proves
 * that defaulted and `@updatedAt` fields may be omitted and that code naming
 * `SheetsDB<Tables>`, `TableHandle<T>` or `Repository<T>` still compiles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import ts from 'typescript'
import { generateClientPackage } from '../../src/generator/client-package-generator.js'
import { DEFAULTS_SCHEMA_YAML, parseFixture } from '../helpers/runtime-defaults-schema.js'

const PACKAGES_DIR = resolve(__dirname, '../../..')
const CORE_SRC = join(PACKAGES_DIR, 'core', 'src', 'index.ts')
const CLIENT_SRC = join(PACKAGES_DIR, 'client', 'src', 'index.ts')
const CORE_TYPE_ROOTS = join(PACKAGES_DIR, 'core', 'node_modules', '@types')

const USAGE = `
import { createClient, createTestClient, schema } from './index.js'
import type { Task, Tables, CreateInputs, TaskCreateInput, SettingCreateInput } from './index.js'
import { Repository, MockAdapter, createSheetsDB } from '@gsquery/core'
import type { SheetsDB, TableHandle } from '@gsquery/core'
import { createClientDB, MockTransport } from '@gsquery/client'

const db = createClient({ mock: true })
const tasks = db.from('Task')

// Defaulted and @updatedAt fields may be omitted
const created: Task = tasks.create({ title: 'x', token: 't', slug: 's', seq: 1 })
const viaRepo: Task = tasks.repo.create({ title: 'x', token: 't', slug: 's', seq: 1 })
const batch: Task[] = tasks.batchInsert([{ title: 'x', token: 't', slug: 's', seq: 1 }])
const inserted: Task = tasks.upsert({ title: 'x', token: 't', slug: 's', seq: 1 })
const patched: Task = tasks.upsert({ id: 1, title: 'patched' })
const updated: Task = tasks.update(1, { title: 'y' })
db.from('Setting').create({ value: 'v' })
db.from('Plain').create({ label: 'l' })

// Explicit values are still accepted
tasks.create({ id: 5, title: 'x', token: 't', slug: 's', seq: 1, status: 'closed', updatedAt: new Date() })

// @ts-expect-error title is required and has no default
tasks.create({ token: 't', slug: 's', seq: 1 })
// @ts-expect-error a uuid default is not applied at runtime, so token stays required
tasks.create({ title: 'x', slug: 's', seq: 1 })
// @ts-expect-error a non-id autoincrement default is not applied either
tasks.create({ title: 'x', token: 't', slug: 's' })
// @ts-expect-error batchInsert has the same requirement
tasks.batchInsert([{ title: 'x' }])
// @ts-expect-error an insert-shaped upsert has the same requirement
tasks.upsert({ token: 't', slug: 's', seq: 1 })
// @ts-expect-error Setting.value has no default
db.from('Setting').create({})
// @ts-expect-error a defaulted field still has its type
tasks.create({ title: 'x', token: 't', slug: 's', seq: 1, priority: 'high' })

// The row interface is unchanged: every non-optional field is required
// @ts-expect-error status is required on the row
const row: Task = { id: 1, title: 'x', priority: 1, done: false, role: 'USER', token: 't', slug: 's', seq: 1, createdAt: new Date(), updatedAt: new Date() }

// The generated input types are exported
const input: TaskCreateInput = { title: 'x', token: 't', slug: 's', seq: 1 }
const settingInput: SettingCreateInput = { value: 'v' }
type InputsHaveTask = CreateInputs['Task']
const fromMap: InputsHaveTask = input

// Code that names the types without the new parameter still compiles
const legacy: SheetsDB<Tables> = createSheetsDB<Tables>({
  config: { tables: { Task: { columns: ['id', 'title'] }, Setting: { columns: ['id'] }, Plain: { columns: ['id'] } } },
  stores: { Task: new MockAdapter<Task>(), Setting: new MockAdapter(), Plain: new MockAdapter() }
})
const handle: TableHandle<Task> = legacy.from('Task')
const full = { title: 'x', status: 's', priority: 1, done: false, role: 'USER' as const, token: 't', slug: 's', seq: 1, createdAt: new Date(), updatedAt: new Date() }
handle.create(full)
handle.batchInsert([full])
handle.upsert(full)
// @ts-expect-error without the create-input parameter every field stays required
handle.create({ title: 'x' })
const repo: Repository<Task> = new Repository<Task>(new MockAdapter<Task>())
repo.create(full)
repo.create({ ...full, id: 1 })
// @ts-expect-error Repository<T> keeps today's create input
repo.create({ title: 'x' })

// The local-first client takes the same create inputs
async function local(): Promise<void> {
  const { db: localDb } = await createClientDB<Tables, CreateInputs>({ schema, transport: new MockTransport(), disableIDB: true })
  localDb.from('Task').create({ id: 1, title: 'x', token: 't', slug: 's', seq: 1 })
  // @ts-expect-error title is still required on the local-first path
  localDb.from('Task').create({ id: 1, token: 't', slug: 's', seq: 1 })
}

export { created, viaRepo, batch, inserted, patched, updated, row, settingInput, fromMap, local, createTestClient }
`

function compile(rootFile: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    verbatimModuleSyntax: true,
    noUnusedLocals: false,
    paths: {
      '@gsquery/core': [CORE_SRC],
      '@gsquery/client': [CLIENT_SRC]
    },
    typeRoots: [CORE_TYPE_ROOTS],
    types: ['node', 'google-apps-script']
  }
  const program = ts.createProgram([rootFile], options)
  return ts.getPreEmitDiagnostics(program)
}

function format(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map(d => {
      const where = d.file && d.start !== undefined
        ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
        : '<global>'
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
    })
    .join('\n')
}

describe('generated --client types compile as intended (#199 AC12)', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsquery-199-'))
    const files = generateClientPackage(parseFixture(DEFAULTS_SCHEMA_YAML))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    writeFileSync(join(dir, 'usage.ts'), USAGE)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('compiles with no diagnostics, and every @ts-expect-error is used', () => {
    const diagnostics = compile(join(dir, 'usage.ts'))
    expect(format(diagnostics)).toBe('')
  }, 120_000)

  it('reports an error when a required field is omitted without a directive', () => {
    writeFileSync(
      join(dir, 'negative.ts'),
      "import { createClient } from './index.js'\n" +
      "createClient({ mock: true }).from('Task').create({ token: 't', slug: 's', seq: 1 })\n"
    )
    const messages = format(compile(join(dir, 'negative.ts')))
    expect(messages).toContain('negative.ts:2')
    expect(messages).toContain("'title'")
  }, 120_000)
})
