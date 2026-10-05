/**
 * DataStore conformance suite (#195).
 *
 * One list of contract clauses that every {@link DataStore} implementation must
 * meet, run against MockAdapter and SheetsAdapter (on the GAS fakes) in core's
 * tests, against LocalAdapter in `@gsquery/client`'s tests, and against any
 * third-party adapter by its author.
 *
 * It takes the caller's `describe`/`it` and asserts by throwing plain errors:
 * it never imports a test runner, so this subpath does not ship one and works
 * under any runner that accepts synchronous test bodies.
 *
 * Every clause compares a store with itself (what a write returned with what a
 * read returns, an indexed store with an unindexed one), never one adapter
 * with another: how a value is represented legitimately differs between
 * adapters, and the suite has to run for a single adapter.
 */
import type { DataStore, IdMode, QueryOptions, UpdateData, WhereCondition } from '../core/types.js'
import type { IndexDefinition } from '../core/index-store.js'

/** Row shape the suite writes. Every field but `id` is optional. */
export type ConformanceRow = {
  id: string | number
  name?: unknown
  f?: unknown
  a?: unknown
  b?: unknown
}

/** Columns of {@link ConformanceRow}, in order, as passed to every factory call. */
export const CONFORMANCE_COLUMNS: readonly string[] = ['id', 'name', 'f', 'a', 'b']

/** What the suite asks a factory for. */
export interface DataStoreFactoryOptions {
  /** Id mode the store must run in. */
  idMode: IdMode
  /**
   * Rows the store must start with, seeded verbatim (not through `insert`):
   * their ids are kept in both id modes. A fresh copy on every call.
   */
  seed: ConformanceRow[]
  /** Column list, for stores with a fixed, positional column set. */
  columns: readonly string[]
  /**
   * Indexes to declare. Empty when the suite wants an unindexed store; a
   * store without index support ignores it.
   */
  indexes: IndexDefinition[]
}

/** A store opened by a factory, plus how to dispose of it. */
export interface DataStoreHandle {
  store: DataStore<ConformanceRow>
  /** Called once after the case that opened the store, pass or fail. */
  cleanup?: () => void
}

/** Opens a new, independent store. Called several times per case. */
export type DataStoreFactory = (options: DataStoreFactoryOptions) => DataStoreHandle

/** Options for {@link runDataStoreConformance}. */
export interface DataStoreConformanceOptions {
  /** Label for the store under test, used in the suite titles. */
  name: string
  /** Opens a store for one case. */
  create: DataStoreFactory
  /** The test runner's `describe` (vitest, jest, mocha, ...). */
  describe: (name: string, body: () => void) => void
  /** The test runner's `it`/`test`. Bodies are synchronous and throw on failure. */
  it: (name: string, body: () => void) => void
  /** Id modes to run the suite in (default: both). */
  idModes?: readonly IdMode[]
}

// ── Assertions ──────────────────────────────────────────────────────────

/** Thrown by a failing clause. */
export class ConformanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConformanceError'
  }
}

function show(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value instanceof Date) return `Date(${value.toISOString()})`
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${show(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return String(value)
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ConformanceError(message)
}

/** Structural equality; a missing key equals `undefined`, Dates compare by instant. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!deepEqual(left[key], right[key])) return false
    }
    return true
  }
  return false
}

function checkEqual(actual: unknown, expected: unknown, what: string): void {
  check(deepEqual(actual, expected), `${what}: expected ${show(expected)}, got ${show(actual)}`)
}

/** Run `fn`, which must throw; returns what it threw. */
function checkThrows(fn: () => unknown, what: string): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new ConformanceError(`${what}: expected a throw, but it returned normally`)
}

/** `DuplicateIdError` from any copy of `@gsquery/core`, recognized by its code. */
function checkDuplicateIdError(error: unknown, id: string | number, what: string): void {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>
  check(
    error instanceof Error && fields.code === 'DUPLICATE_ID',
    `${what}: expected a DuplicateIdError (code DUPLICATE_ID), got ${show(error instanceof Error ? error.message : error)}`
  )
  checkEqual(fields.id, id, `${what}: DuplicateIdError.id`)
}

/** Empty-cell rule: a field written empty reads back as one of the three empty values. */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

const key = (id: string | number): string => String(id)

/** Ids of every row, as strings, in scan order. */
function idsOf(store: DataStore<ConformanceRow>): string[] {
  return store.findAll().map(row => key(row.id))
}

function isUsableId(id: unknown): id is string | number {
  return (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))
}

function cloneRow(row: ConformanceRow): ConformanceRow {
  const copy: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(row)) {
    copy[field] = value instanceof Date ? new Date(value.getTime()) : value
  }
  return copy as ConformanceRow
}

function findEq(store: DataStore<ConformanceRow>, ...conditions: Array<[keyof ConformanceRow & string, unknown]>) {
  const where: WhereCondition<ConformanceRow>[] = conditions.map(([field, value]) => ({
    field,
    operator: '=',
    value,
  }))
  const options: QueryOptions<ConformanceRow> = { where, orderBy: [] }
  return store.find(options)
}

// ── Suite ───────────────────────────────────────────────────────────────

type Open = (seed?: ConformanceRow[], indexes?: IndexDefinition[]) => DataStore<ConformanceRow>

interface Capabilities {
  batchInsert: boolean
  batchUpdate: boolean
  batchDelete: boolean
  count: boolean
}

/**
 * Register the DataStore contract clauses under `describe`, once per id mode.
 *
 * Clauses: CRUD (the optional `batchInsert`, `batchUpdate`, `batchDelete` and
 * `count` only when the store implements them), id immutability through
 * `update`/`batchUpdate`, client-id uniqueness, empty-cell semantics,
 * index-vs-scan parity of `=` finds, and auto-id monotonicity within one store
 * instance.
 *
 * Which optional methods a store implements is read from one store opened
 * (and cleaned up) while the suite registers its cases.
 */
export function runDataStoreConformance(options: DataStoreConformanceOptions): void {
  const { name, create, describe, it } = options
  const idModes = options.idModes ?? (['auto', 'client'] as const)

  for (const idMode of idModes) {
    describe(`${name} DataStore conformance (${idMode} ids)`, () => {
      const factoryOptions = (seed: ConformanceRow[], indexes: IndexDefinition[]): DataStoreFactoryOptions => ({
        idMode,
        seed: seed.map(cloneRow),
        columns: [...CONFORMANCE_COLUMNS],
        indexes: indexes.map(index => ({ ...index, fields: [...index.fields] })),
      })

      const probe = create(factoryOptions([], []))
      const caps: Capabilities = {
        batchInsert: typeof probe.store.batchInsert === 'function',
        batchUpdate: typeof probe.store.batchUpdate === 'function',
        batchDelete: typeof probe.store.batchDelete === 'function',
        count: typeof probe.store.count === 'function',
      }
      probe.cleanup?.()

      const test = (title: string, body: (open: Open) => void): void => {
        it(title, () => {
          const handles: DataStoreHandle[] = []
          const open: Open = (seed = [], indexes = []) => {
            const handle = create(factoryOptions(seed, indexes))
            handles.push(handle)
            return handle.store
          }
          try {
            body(open)
          } finally {
            for (const handle of handles.reverse()) handle.cleanup?.()
          }
        })
      }

      registerCrud(test, idMode, caps)
      registerIdImmutability(test, idMode, caps)
      if (idMode === 'client') registerClientIds(test, caps)
      if (idMode === 'auto') registerAutoIds(test, caps)
      registerEmptyCells(test, idMode)
      registerIndexParity(test)
    })
  }
}

type Register = (title: string, body: (open: Open) => void) => void

/**
 * Build an insert payload: with `clientId` in client mode, without an id in
 * auto mode (where the store allocates it).
 */
function payload(
  idMode: IdMode,
  clientId: string | number,
  fields: Omit<ConformanceRow, 'id'>
): ConformanceRow | Omit<ConformanceRow, 'id'> {
  return idMode === 'client' ? { id: clientId, ...fields } : { ...fields }
}

/** An id no row in these tests ever gets. */
const ABSENT_ID = 'no-such-id'

function registerCrud(test: Register, idMode: IdMode, caps: Capabilities): void {
  test('crud: insert returns the row with a usable id, and findById/findAll read it back', open => {
    const store = open()
    const first = store.insert(payload(idMode, 'a', { name: 'Alice' }))
    const second = store.insert(payload(idMode, 'b', { name: 'Bob' }))

    check(isUsableId(first.id), `insert returned id ${show(first.id)}`)
    check(isUsableId(second.id), `insert returned id ${show(second.id)}`)
    check(key(first.id) !== key(second.id), `two inserts returned the same id ${show(first.id)}`)
    if (idMode === 'client') {
      checkEqual(first.id, 'a', 'client-mode insert keeps the caller id')
    }
    checkEqual(first.name, 'Alice', 'insert result name')

    const read = store.findById(first.id)
    check(read !== undefined, `findById(${show(first.id)}) after insert returned undefined`)
    checkEqual(key(read.id), key(first.id), 'findById row id')
    checkEqual(read.name, 'Alice', 'findById row name')
    checkEqual(idsOf(store), [key(first.id), key(second.id)], 'findAll ids, in insertion order')
  })

  test('crud: findById returns undefined for an id no row has', open => {
    const store = open()
    store.insert(payload(idMode, 'a', { name: 'Alice' }))
    checkEqual(store.findById(ABSENT_ID), undefined, 'findById of an absent id')
  })

  test('crud: update merges the patch, returns the updated row, and reads reflect it', open => {
    const store = open()
    const row = store.insert(payload(idMode, 'a', { name: 'Alice', f: 'kept' }))

    const updated = store.update(row.id, { name: 'Alicia' })
    check(updated !== undefined, 'update of an existing row returned undefined')
    checkEqual(key(updated.id), key(row.id), 'update result id')
    checkEqual(updated.name, 'Alicia', 'update result name')
    checkEqual(updated.f, 'kept', 'update result keeps fields the patch did not name')

    const read = store.findById(row.id)
    checkEqual(read?.name, 'Alicia', 'findById name after update')
    checkEqual(read?.f, 'kept', 'findById untouched field after update')
  })

  test('crud: update of an id no row has returns undefined and writes nothing', open => {
    const store = open()
    const row = store.insert(payload(idMode, 'a', { name: 'Alice' }))

    checkEqual(store.update(ABSENT_ID, { name: 'Ghost' }), undefined, 'update of an absent id')
    checkEqual(idsOf(store), [key(row.id)], 'ids after updating an absent id')
    checkEqual(store.findById(row.id)?.name, 'Alice', 'existing row after updating an absent id')
  })

  test('crud: delete removes the row and returns true, then false for the same id', open => {
    const store = open()
    const first = store.insert(payload(idMode, 'a', { name: 'Alice' }))
    const second = store.insert(payload(idMode, 'b', { name: 'Bob' }))

    checkEqual(store.delete(first.id), true, 'delete of an existing row')
    checkEqual(store.findById(first.id), undefined, 'findById after delete')
    checkEqual(idsOf(store), [key(second.id)], 'ids after delete')
    checkEqual(store.delete(first.id), false, 'second delete of the same id')
    checkEqual(store.delete(ABSENT_ID), false, 'delete of an absent id')
    checkEqual(store.findById(second.id)?.name, 'Bob', 'the other row after delete')
  })

  test('crud: find filters, sorts, offsets and limits', open => {
    const store = open()
    const rows = [5, 1, 4, 2, 3].map((a, i) => store.insert(payload(idMode, `r${i}`, { name: `n${a}`, a })))

    const found = store.find({
      where: [{ field: 'a', operator: '>=', value: 2 }],
      orderBy: [{ field: 'a', direction: 'desc' }],
      offsetValue: 1,
      limitValue: 2,
    })
    checkEqual(found.map(row => row.a), [4, 3], 'find a >= 2, a desc, offset 1, limit 2')

    const byName = findEq(store, ['name', 'n1'])
    checkEqual(byName.map(row => key(row.id)), [key(rows[1].id)], 'find name = "n1"')
    checkEqual(findEq(store, ['name', 'nope']), [], 'find with no match')
  })

  if (caps.batchInsert) {
    test('crud: batchInsert inserts every row and returns them with usable, distinct ids', open => {
      const store = open()
      const inserted = store.batchInsert!([
        payload(idMode, 'a', { name: 'Alice' }),
        payload(idMode, 'b', { name: 'Bob' }),
      ])

      checkEqual(inserted.length, 2, 'batchInsert result length')
      check(inserted.every(row => isUsableId(row.id)), `batchInsert ids ${show(inserted.map(r => r.id))}`)
      check(key(inserted[0].id) !== key(inserted[1].id), 'batchInsert returned one id twice')
      checkEqual(idsOf(store), inserted.map(row => key(row.id)), 'findAll ids after batchInsert')
      checkEqual(store.findById(inserted[1].id)?.name, 'Bob', 'findById after batchInsert')
      checkEqual(store.batchInsert!([]), [], 'batchInsert of no rows')
      checkEqual(idsOf(store).length, 2, 'row total after an empty batchInsert')
    })
  }

  if (caps.batchUpdate) {
    test('crud: batchUpdate updates existing rows, skips absent ids, and returns the updated rows', open => {
      const store = open()
      const first = store.insert(payload(idMode, 'a', { name: 'Alice', f: 'kept' }))
      const second = store.insert(payload(idMode, 'b', { name: 'Bob' }))

      const updated = store.batchUpdate!([
        { id: first.id, data: { name: 'Alicia' } },
        { id: ABSENT_ID, data: { name: 'Ghost' } },
        { id: second.id, data: { name: 'Robert' } },
      ])

      checkEqual(
        updated.map(row => [key(row.id), row.name]).sort(),
        [[key(first.id), 'Alicia'], [key(second.id), 'Robert']].sort(),
        'batchUpdate result'
      )
      checkEqual(store.findById(first.id)?.name, 'Alicia', 'findById after batchUpdate')
      checkEqual(store.findById(first.id)?.f, 'kept', 'batchUpdate keeps fields the patch did not name')
      checkEqual(store.findById(second.id)?.name, 'Robert', 'findById after batchUpdate')
      checkEqual(idsOf(store), [key(first.id), key(second.id)], 'ids after batchUpdate')
    })
  }

  if (caps.batchDelete) {
    test('crud: batchDelete deletes the given rows and returns how many, skipping absent and repeated ids', open => {
      const store = open()
      const rows = ['a', 'b', 'c'].map(id => store.insert(payload(idMode, id, { name: id })))

      const deleted = store.batchDelete!([rows[0].id, rows[0].id, ABSENT_ID, rows[2].id])
      checkEqual(deleted, 2, 'batchDelete result')
      checkEqual(idsOf(store), [key(rows[1].id)], 'ids after batchDelete')
      checkEqual(store.findById(rows[0].id), undefined, 'findById of a batch-deleted row')
      checkEqual(store.batchDelete!([]), 0, 'batchDelete of no ids')
    })
  }

  if (caps.count) {
    test('crud: count equals the number of rows addressable by id', open => {
      const store = open()
      checkEqual(store.count!(), 0, 'count of an empty store')
      const rows = ['a', 'b', 'c'].map(id => store.insert(payload(idMode, id, { name: id })))
      checkEqual(store.count!(), 3, 'count after three inserts')
      store.delete(rows[1].id)
      checkEqual(store.count!(), 2, 'count after a delete')
      checkEqual(store.count!(), store.findAll().length, 'count vs findAll length')
    })
  }
}

function registerIdImmutability(test: Register, idMode: IdMode, caps: Capabilities): void {
  /** Patch type that smuggles an id in, as untyped callers can. */
  const withId = (id: string | number, fields: UpdateData<ConformanceRow>): UpdateData<ConformanceRow> =>
    ({ ...fields, id }) as UpdateData<ConformanceRow>

  test('id immutability: update ignores an id in the payload', open => {
    const store = open()
    const row = store.insert(payload(idMode, 'a', { name: 'Alice' }))
    const other = store.insert(payload(idMode, 'b', { name: 'Bob' }))
    const before = idsOf(store)

    const updated = store.update(row.id, withId('moved', { name: 'Alicia' }))
    checkEqual(key(updated?.id ?? ''), key(row.id), 'update result id')
    checkEqual(store.findById(row.id)?.name, 'Alicia', 'findById(original id) after update')
    checkEqual(store.findById('moved'), undefined, 'findById(payload id) after update')
    checkEqual(idsOf(store), before, 'ids after update with an id in the payload')
    checkEqual(store.findById(other.id)?.name, 'Bob', 'the other row')
  })

  test("id immutability: update cannot move a row onto another row's id", open => {
    const store = open()
    const row = store.insert(payload(idMode, 'a', { name: 'Alice' }))
    const other = store.insert(payload(idMode, 'b', { name: 'Bob' }))
    const before = idsOf(store)

    store.update(row.id, withId(other.id, { name: 'Alicia' }))
    checkEqual(idsOf(store), before, 'ids after update with a taken id in the payload')
    checkEqual(store.findById(row.id)?.name, 'Alicia', 'findById(original id)')
    checkEqual(store.findById(other.id)?.name, 'Bob', "findById(other row's id)")
  })

  if (caps.batchUpdate) {
    test('id immutability: batchUpdate ignores an id in the payload', open => {
      const store = open()
      const row = store.insert(payload(idMode, 'a', { name: 'Alice' }))
      const other = store.insert(payload(idMode, 'b', { name: 'Bob' }))
      const before = idsOf(store)

      const [updated] = store.batchUpdate!([{ id: row.id, data: withId('moved', { name: 'Alicia' }) }])
      checkEqual(key(updated?.id ?? ''), key(row.id), 'batchUpdate result id')
      checkEqual(store.findById(row.id)?.name, 'Alicia', 'findById(original id) after batchUpdate')
      checkEqual(store.findById('moved'), undefined, 'findById(payload id) after batchUpdate')

      store.batchUpdate!([{ id: row.id, data: withId(other.id, {}) }])
      checkEqual(idsOf(store), before, 'ids after batchUpdate with ids in the payload')
      checkEqual(store.findById(other.id)?.name, 'Bob', "findById(other row's id)")
    })
  }
}

function registerClientIds(test: Register, caps: Capabilities): void {
  test('client ids: insert rejects a taken id with DuplicateIdError and writes nothing', open => {
    const store = open()
    store.insert({ id: 'a', name: 'Alice' })

    const error = checkThrows(() => store.insert({ id: 'a', name: 'Clone' }), 'insert of a taken id')
    checkDuplicateIdError(error, 'a', 'insert of a taken id')
    checkEqual(idsOf(store), ['a'], 'ids after a rejected insert')
    checkEqual(store.findById('a')?.name, 'Alice', 'the existing row after a rejected insert')
  })

  test("client ids: 7 and '7' are the same id", open => {
    const numeric = open()
    numeric.insert({ id: 7, name: 'Seven' })
    const one = checkThrows(() => numeric.insert({ id: '7', name: 'Clone' }), "insert '7' after 7")
    checkDuplicateIdError(one, '7', "insert '7' after 7")
    checkEqual(idsOf(numeric), ['7'], "ids after the rejected '7'")

    const text = open()
    text.insert({ id: '7', name: 'Seven' })
    const two = checkThrows(() => text.insert({ id: 7, name: 'Clone' }), "insert 7 after '7'")
    checkDuplicateIdError(two, 7, "insert 7 after '7'")
    checkEqual(idsOf(text), ['7'], 'ids after the rejected 7')
  })

  test('client ids: insert without an id throws and writes nothing', open => {
    const store = open()
    store.insert({ id: 'a', name: 'Alice' })
    checkThrows(() => store.insert({ name: 'No id' }), 'insert without an id')
    checkEqual(idsOf(store), ['a'], 'ids after an insert without an id')
  })

  test('client ids: distinct ids are accepted', open => {
    const store = open()
    store.insert({ id: 'a', name: 'Alice' })
    store.insert({ id: 'b', name: 'Bob' })
    store.insert({ id: 1, name: 'One' })
    checkEqual(idsOf(store), ['a', 'b', '1'], 'ids after distinct inserts')
  })

  test('client ids: an id is free again once its row is deleted', open => {
    const store = open()
    store.insert({ id: 'a', name: 'Alice' })
    checkEqual(store.delete('a'), true, 'delete')
    store.insert({ id: 'a', name: 'Reused' })
    checkEqual(idsOf(store), ['a'], 'ids after reusing a deleted id')
    checkEqual(store.findById('a')?.name, 'Reused', 'findById of the reused id')
  })

  if (caps.batchInsert) {
    test('client ids: batchInsert with one taken id writes nothing', open => {
      const store = open()
      store.insert({ id: 'a', name: 'Alice' })
      const error = checkThrows(
        () => store.batchInsert!([{ id: 'b', name: 'Bob' }, { id: 'a', name: 'Clone' }]),
        'batchInsert with a taken id'
      )
      checkDuplicateIdError(error, 'a', 'batchInsert with a taken id')
      checkEqual(idsOf(store), ['a'], 'ids after the rejected batchInsert')
    })

    test('client ids: batchInsert with an id repeated inside the batch writes nothing', open => {
      const store = open()
      const error = checkThrows(
        () => store.batchInsert!([{ id: 'a', name: 'Alice' }, { id: 'a', name: 'Clone' }]),
        'batchInsert with a repeated id'
      )
      checkDuplicateIdError(error, 'a', 'batchInsert with a repeated id')
      checkThrows(
        () => store.batchInsert!([{ id: 1, name: 'One' }, { id: '1', name: 'Clone' }]),
        "batchInsert with 1 and '1'"
      )
      checkEqual(idsOf(store), [], 'ids after the rejected batchInserts')
    })

    test('client ids: batchInsert where a later row has no id writes nothing', open => {
      const store = open()
      checkThrows(
        () => store.batchInsert!([{ id: 'a', name: 'Alice' }, { name: 'No id' }]),
        'batchInsert with a row without an id'
      )
      checkEqual(idsOf(store), [], 'ids after the rejected batchInsert')
    })
  }
}

function registerAutoIds(test: Register, caps: Capabilities): void {
  const numericId = (id: string | number): number => {
    const n = Number(id)
    check(Number.isFinite(n), `auto id ${show(id)} is not numeric`)
    return n
  }

  test('auto ids: an id in the insert payload is replaced, not rejected', open => {
    const store = open()
    const first = store.insert({ id: 1, name: 'Alice' })
    const second = store.insert({ id: 1, name: 'Bob' })
    const all = [first, second]
    if (caps.batchInsert) all.push(...store.batchInsert!([{ id: 1, name: 'Carol' }]))

    const ids = all.map(row => key(row.id))
    checkEqual(new Set(ids).size, ids.length, `distinct ids among ${show(ids)}`)
    checkEqual(idsOf(store), ids, 'findAll ids')
  })

  test('auto ids: after deleting the highest id, the next insert gets a greater id', open => {
    const store = open()
    const issued = ['a', 'b', 'c'].map(name => numericId(store.insert({ name }).id))
    const highest = Math.max(...issued)
    checkEqual(store.delete(highest), true, 'delete of the highest id')

    const next = numericId(store.insert({ name: 'd' }).id)
    check(next > highest, `insert after deleting ${highest} returned ${next}; ids issued: ${show(issued)}`)
  })

  test('auto ids: after deleting every row, the next insert gets a greater id', open => {
    const store = open()
    const issued = ['a', 'b'].map(name => numericId(store.insert({ name }).id))
    for (const id of issued) store.delete(id)

    const next = numericId(store.insert({ name: 'c' }).id)
    check(next > Math.max(...issued), `insert on an emptied store returned ${next}; ids issued: ${show(issued)}`)
  })

  if (caps.batchInsert) {
    test('auto ids: batchInsert after deleting the highest id gets greater ids', open => {
      const store = open()
      const issued = store.batchInsert!([{ name: 'a' }, { name: 'b' }]).map(row => numericId(row.id))
      const highest = Math.max(...issued)
      store.delete(highest)

      const next = store.batchInsert!([{ name: 'c' }, { name: 'd' }]).map(row => numericId(row.id))
      check(next.every(id => id > highest), `batchInsert after deleting ${highest} returned ${show(next)}`)
    })
  }
}

function registerEmptyCells(test: Register, idMode: IdMode): void {
  const empties: Array<[label: string, value: unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ["''", ''],
  ]

  const checkEmpty = (store: DataStore<ConformanceRow>, id: string | number, what: string): void => {
    const byId = store.findById(id)
    check(byId !== undefined, `${what}: findById returned undefined`)
    check(isEmptyValue(byId.f), `${what}: findById read f as ${show(byId.f)}`)
    const inAll = store.findAll().find(row => key(row.id) === key(id))
    check(inAll !== undefined, `${what}: row missing from findAll`)
    check(isEmptyValue(inAll.f), `${what}: findAll read f as ${show(inAll.f)}`)
  }

  test('empty cells: a field written as undefined, null or empty string reads back empty', open => {
    const store = open()
    empties.forEach(([label, value], i) => {
      const row = store.insert(payload(idMode, `e${i}`, { name: label, f: value }))
      checkEmpty(store, row.id, `insert with f = ${label}`)
    })
    const missing = store.insert(payload(idMode, 'missing', { name: 'missing' }))
    checkEmpty(store, missing.id, 'insert without f')
  })

  test('empty cells: updating a field to undefined, null or empty string reads back empty', open => {
    const store = open()
    for (const [label, value] of empties) {
      const row = store.insert(payload(idMode, `u-${label}`, { name: label, f: 'full' }))
      store.update(row.id, { f: value })
      checkEmpty(store, row.id, `update to f = ${label}`)
    }
  })
}

function registerIndexParity(test: Register): void {
  /**
   * Open the same seed twice, with and without `indexes`, run `mutate` on
   * both, and return them for comparison.
   */
  const pair = (
    open: Open,
    seed: ConformanceRow[],
    indexes: IndexDefinition[],
    mutate: (store: DataStore<ConformanceRow>) => void = () => {}
  ) => {
    const indexed = open(seed, indexes)
    const scan = open(seed, [])
    mutate(indexed)
    mutate(scan)
    return { indexed, scan }
  }

  const checkParity = (
    { indexed, scan }: { indexed: DataStore<ConformanceRow>; scan: DataStore<ConformanceRow> },
    conditions: Array<[keyof ConformanceRow & string, unknown]>,
    expectedIds?: string[]
  ): void => {
    const what = `find ${conditions.map(([f, v]) => `${f} = ${show(v)}`).join(' and ')}`
    const got = findEq(indexed, ...conditions)
    checkEqual(got, findEq(scan, ...conditions), `${what}: indexed vs unindexed`)
    if (expectedIds !== undefined) {
      checkEqual(got.map(row => key(row.id)), expectedIds, `${what}: ids`)
    }
  }

  test('index parity: a single-field find after updates move rows between values', open => {
    const seed = [1, 2, 3, 4, 5].map(id => ({ id, f: id === 3 || id === 4 ? 'x' : 'o' }))
    const stores = pair(open, seed, [{ fields: ['f'] }], store => {
      store.update(3, { f: 'y' })
      store.update(3, { f: 'x' })
    })
    checkParity(stores, [['f', 'x']], ['3', '4'])
    checkParity(stores, [['f', 'o']], ['1', '2', '5'])
  })

  test('index parity: null against a missing field', open => {
    const seed: ConformanceRow[] = [{ id: 1 }, { id: 2, f: null }, { id: 3, f: 'a' }]
    const stores = pair(open, seed, [{ fields: ['f'] }])
    checkParity(stores, [['f', null]])
    checkParity(stores, [['f', 'a']], ['3'])
  })

  test('index parity: a Date against its ISO string', open => {
    const iso = new Date(0).toISOString()
    const seed: ConformanceRow[] = [
      { id: 1, f: iso },
      { id: 2, f: new Date(0) },
    ]
    const stores = pair(open, seed, [{ fields: ['f'] }])
    checkParity(stores, [['f', new Date(0)]])
    checkParity(stores, [['f', iso]])
  })

  test("index parity: 1 against '1'", open => {
    const seed: ConformanceRow[] = [
      { id: 1, f: '1' },
      { id: 2, f: 1 },
    ]
    const stores = pair(open, seed, [{ fields: ['f'] }])
    checkParity(stores, [['f', 1]], ['2'])
    checkParity(stores, [['f', '1']], ['1'])
  })

  test('index parity: a miss, a find after a delete, and a compound find after updates', open => {
    const seed = [1, 2, 3, 4].map(id => ({ id, f: 'x', a: id % 2, b: 2 }))
    const stores = pair(open, seed, [{ fields: ['f'] }, { fields: ['a', 'b'] }])
    checkParity(stores, [['f', 'nope']], [])

    for (const store of [stores.indexed, stores.scan]) store.delete(2)
    checkParity(stores, [['f', 'x']], ['1', '3', '4'])

    for (const store of [stores.indexed, stores.scan]) {
      store.update(3, { a: 9 })
      store.update(3, { a: 1 })
    }
    checkParity(stores, [['a', 1], ['b', 2]], ['1', '3'])
    checkParity(stores, [['f', 'x'], ['a', 0]], ['4'])
  })

  test('index parity: finds after deletes at the front, middle and back with mixed id types', open => {
    const seed: ConformanceRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: i % 2 ? i : `s${i}`,
      f: ['a', 'b', 'c'][i % 3],
      a: i % 2,
    }))
    const stores = pair(open, seed, [{ fields: ['f'] }, { fields: ['f', 'a'] }])
    const checkAll = (): void => {
      for (const f of ['a', 'b', 'c']) {
        checkParity(stores, [['f', f]])
        for (const a of [0, 1]) checkParity(stores, [['f', f], ['a', a]])
      }
    }

    checkAll()
    const steps = [[0], [25], [49], [3, 10, 20, 31, 44]]
    for (const step of steps) {
      const ids = step.map(i => seed[i].id)
      for (const store of [stores.indexed, stores.scan]) {
        // Several ids at once go through batchDelete where the store has it.
        if (ids.length > 1 && store.batchDelete) store.batchDelete(ids)
        else for (const id of ids) store.delete(id)
      }
      checkAll()
    }
    checkParity(stores, [['f', 'a']], ['s6', '9', 's12', '15', 's18', '21', 's24', '27', 's30', '33', 's36', '39', 's42', '45', 's48'])
  })
}
