/**
 * S6 — Two-client convergence measurement (production scenario).
 *
 * Two independent `createClientDB` instances (two browsers, two mutation
 * queues) against ONE shared, stateful mock Apps Script backend. Both pull the
 * same snapshot, both edit overlapping rows offline, then A syncs, then B
 * syncs, then both pull.
 *
 * The suite MEASURES the outcome rather than asserting a policy: how many of
 * client A's field-writes survive, and which were silently overwritten. The
 * root cause is #138 — `MergedMutation` carries `{id, type, data}` and nothing
 * else, so the server has no base version to compare against and can never
 * populate `conflicts`. Both clients report a clean, successful, "converged"
 * sync while writes disappear.
 *
 * Two backend write policies are measured, because the loss depends on the
 * server's granularity and both shapes are written in practice:
 *
 * - `row-replace`  — the naive handler rewrites the whole sheet row from the
 *   pushed object. Columns the pusher never mentioned are blanked.
 * - `field-merge`  — the careful handler patches only the pushed columns.
 *   This is the loss FLOOR: even here A's writes vanish with no signal.
 */
import { describe, it, expect } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { createClientDB } from '../../src/local/create-client-db.js'
import type { ClientDBResult, ClientDBSchema } from '../../src/local/create-client-db.js'
import type { MutationStorage } from '../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  SyncEvent,
  SyncPushResult,
  SyncTransport,
} from '../../src/local/sync-transport.js'

interface Doc extends RowWithId {
  id: string
  x: string
  y: string
  z: string
  note: string
}

type Tables = { Doc: Doc }

/**
 * A row as it actually comes back from the shared backend. Under
 * `row-replace` the server drops columns nobody pushed, so the runtime shape
 * is a subset of `Doc` even though the client types it as `Doc`.
 */
type ServerDoc = Partial<Doc> & RowWithId

const schema: ClientDBSchema = {
  tables: {
    Doc: { columns: ['id', 'x', 'y', 'z', 'note'] },
  },
}

const SEED: Doc[] = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1
  return { id: `r${n}`, x: `x${n}`, y: `y${n}`, z: `z${n}`, note: `n${n}` }
})

/** How the backend writes an `update` mutation back to the sheet. */
type ServerWritePolicy = 'row-replace' | 'field-merge'

/**
 * One shared, stateful backend for both clients.
 *
 * Honors the documented push contract minimally: inserts are upserts, deletes
 * are no-ops when the row is gone, and `appliedIds` reports exactly what was
 * committed. It never reports a conflict — not out of laziness, but because
 * the protocol gives it nothing to detect one with (#138).
 */
class SharedGasBackend {
  private readonly rows = new Map<string | number, ServerDoc>()
  readonly pushLog: Array<{ client: string; mutations: MergedMutation<ServerDoc>[] }> = []
  conflictsReported = 0

  constructor(private readonly policy: ServerWritePolicy) {
    for (const row of SEED) this.rows.set(row.id, { ...row })
  }

  snapshot(): ServerDoc[] {
    return [...this.rows.values()].map(r => ({ ...r }))
  }

  apply(client: string, mutations: MergedMutation<ServerDoc>[]): SyncPushResult<ServerDoc> {
    this.pushLog.push({ client, mutations: mutations.map(m => ({ ...m })) })

    for (const m of mutations) {
      if (m.type === 'delete') {
        this.rows.delete(m.id)
        continue
      }
      if (m.type === 'insert') {
        this.rows.set(m.id, { ...m.data, id: m.id } as ServerDoc)
        continue
      }
      const existing = this.rows.get(m.id)
      if (!existing) continue
      this.rows.set(
        m.id,
        this.policy === 'row-replace'
          ? ({ ...m.data, id: m.id } as ServerDoc)
          : ({ ...existing, ...m.data, id: m.id } as ServerDoc)
      )
    }

    // No base version arrives with the batch, so there is nothing to compare
    // the stored row against. `conflicts` stays empty by construction.
    return { success: true, appliedIds: mutations.map(m => m.id) }
  }
}

/** Per-client link to the shared backend. */
class ClientLink implements SyncTransport {
  constructor(
    private readonly backend: SharedGasBackend,
    private readonly clientName: string
  ) {}

  async pull<T extends RowWithId>(_tableName: string): Promise<{ rows: T[] }> {
    return { rows: this.backend.snapshot() as unknown as T[] }
  }

  async push<T extends RowWithId>(
    _tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    return this.backend.apply(
      this.clientName,
      mutations as unknown as MergedMutation<ServerDoc>[]
    ) as unknown as SyncPushResult<T>
  }
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

function openClient(
  backend: SharedGasBackend,
  name: string
): Promise<ClientDBResult<Tables>> {
  return createClientDB<Tables>({
    schema,
    transport: new ClientLink(backend, name),
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
    namespace: name,
  })
}

function sortById(rows: readonly ServerDoc[]): ServerDoc[] {
  return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function localRows(session: ClientDBResult<Tables>): ServerDoc[] {
  return sortById(session.db.from('Doc').findAll() as ServerDoc[])
}

/** One intended field-level write by a client. */
interface FieldWrite {
  row: string
  field: 'x' | 'y' | 'z'
  value: string
}

/** Client A edits fields x and y of rows 1-5. */
const A_WRITES: FieldWrite[] = [1, 2, 3, 4, 5].flatMap(n => [
  { row: `r${n}`, field: 'x' as const, value: `A-x${n}` },
  { row: `r${n}`, field: 'y' as const, value: `A-y${n}` },
])

/** Client B edits fields y and z of rows 3-8. */
const B_WRITES: FieldWrite[] = [3, 4, 5, 6, 7, 8].flatMap(n => [
  { row: `r${n}`, field: 'y' as const, value: `B-y${n}` },
  { row: `r${n}`, field: 'z' as const, value: `B-z${n}` },
])

function applyWrites(session: ClientDBResult<Tables>, writes: FieldWrite[]): void {
  const byRow = new Map<string, Partial<Doc>>()
  for (const w of writes) {
    const patch = byRow.get(w.row) ?? {}
    patch[w.field] = w.value
    byRow.set(w.row, patch)
  }
  for (const [id, patch] of byRow) {
    session.db.from('Doc').update(id, patch)
  }
}

/** Split intended writes into the ones still visible on the server and the ones gone. */
function measure(
  writes: FieldWrite[],
  final: readonly ServerDoc[]
): { kept: FieldWrite[]; lost: FieldWrite[] } {
  const byId = new Map(final.map(r => [String(r.id), r]))
  const kept: FieldWrite[] = []
  const lost: FieldWrite[] = []
  for (const w of writes) {
    if (byId.get(w.row)?.[w.field] === w.value) kept.push(w)
    else lost.push(w)
  }
  return { kept, lost }
}

function describeWrites(writes: readonly FieldWrite[]): string[] {
  return writes.map(w => `${w.row}.${w.field}`)
}

/**
 * Drives the full two-client workflow and returns the shared final state.
 * Both clients end up reading the same rows, which is what makes the loss
 * invisible to either of them.
 */
async function runConvergence(policy: ServerWritePolicy): Promise<{
  backend: SharedGasBackend
  final: ServerDoc[]
  clientA: ClientDBResult<Tables>
  clientB: ClientDBResult<Tables>
  events: { a: SyncEvent[]; b: SyncEvent[] }
}> {
  const backend = new SharedGasBackend(policy)
  const clientA = await openClient(backend, 'clientA')
  const clientB = await openClient(backend, 'clientB')

  const events = { a: [] as SyncEvent[], b: [] as SyncEvent[] }
  clientA.sync.on(e => events.a.push(e))
  clientB.sync.on(e => events.b.push(e))

  // Both load the same snapshot.
  await clientA.sync.pull()
  await clientB.sync.pull()
  expect(localRows(clientA)).toEqual(SEED)
  expect(localRows(clientB)).toEqual(SEED)

  // Both edit offline (no transport traffic until sync is called).
  applyWrites(clientA, A_WRITES)
  applyWrites(clientB, B_WRITES)

  // A syncs, then B syncs, then both refresh.
  await clientA.sync.sync()
  await clientB.sync.sync()
  await clientA.sync.pull()
  await clientB.sync.pull()

  return { backend, final: sortById(backend.snapshot()), clientA, clientB, events }
}

describe('S6 two-client convergence', () => {
  it('carries no base version on the wire, so conflicts are undetectable [#138]', async () => {
    const { backend, clientA, clientB, events } = await runConvergence('field-merge')

    // Every pushed mutation is exactly {id, type, data} — no version, no
    // timestamp, no seq. The server cannot tell a fresh write from a stale one.
    const pushed = backend.pushLog.flatMap(entry => entry.mutations)
    expect(pushed.length).toBeGreaterThan(0)
    for (const mutation of pushed) {
      expect(Object.keys(mutation).sort()).toEqual(['data', 'id', 'type'])
    }

    // Consequently no conflict was ever reported, and both clients experienced
    // a completely clean sync.
    expect(backend.conflictsReported).toBe(0)
    expect(events.a.filter(e => e.type === 'error')).toEqual([])
    expect(events.b.filter(e => e.type === 'error')).toEqual([])
    expect(events.a.some(e => e.type === 'sync-complete')).toBe(true)
    expect(events.b.some(e => e.type === 'sync-complete')).toBe(true)

    await clientA.close()
    await clientB.close()
  })

  it(
    'loses 6 of client A\'s 10 field-writes to whole-row LWW ' +
      '[documents: lww-field-loss]',
    async () => {
      const { final, clientA, clientB } = await runConvergence('row-replace')

      // ── Exact converged state ───────────────────────────────────────
      // Rows 1-2 keep A's write (B never touched them). Rows 3-5 were
      // overlapping and B pushed last, so its whole-row write is all that
      // remains. Rows 6-8 are B's alone.
      expect(final).toEqual([
        { id: 'r1', x: 'A-x1', y: 'A-y1' },
        { id: 'r2', x: 'A-x2', y: 'A-y2' },
        { id: 'r3', y: 'B-y3', z: 'B-z3' },
        { id: 'r4', y: 'B-y4', z: 'B-z4' },
        { id: 'r5', y: 'B-y5', z: 'B-z5' },
        { id: 'r6', y: 'B-y6', z: 'B-z6' },
        { id: 'r7', y: 'B-y7', z: 'B-z7' },
        { id: 'r8', y: 'B-y8', z: 'B-z8' },
      ])

      // ── A's losses ──────────────────────────────────────────────────
      const a = measure(A_WRITES, final)
      expect(A_WRITES).toHaveLength(10)
      expect(a.kept).toHaveLength(4)
      expect(a.lost).toHaveLength(6)
      expect(describeWrites(a.kept)).toEqual(['r1.x', 'r1.y', 'r2.x', 'r2.y'])
      expect(describeWrites(a.lost)).toEqual([
        'r3.x',
        'r3.y',
        'r4.x',
        'r4.y',
        'r5.x',
        'r5.y',
      ])

      // Half of A's losses are fields B NEVER WROTE. B pushed only {y, z} for
      // rows 3-5; x was collateral damage of the whole-row write.
      const bTouched = new Set(B_WRITES.map(w => `${w.row}.${w.field}`))
      const clobberedUntouched = a.lost.filter(w => !bTouched.has(`${w.row}.${w.field}`))
      expect(describeWrites(clobberedUntouched)).toEqual(['r3.x', 'r4.x', 'r5.x'])
      expect(clobberedUntouched).toHaveLength(3)

      // ── B's writes all survive: last writer takes everything ────────
      const b = measure(B_WRITES, final)
      expect(B_WRITES).toHaveLength(12)
      expect(b.lost).toEqual([])
      expect(b.kept).toHaveLength(12)

      // ── Collateral loss of columns neither client edited ────────────
      // `note` was on all 8 seeded rows and is now on none of them.
      expect(final.filter(r => r.note !== undefined)).toEqual([])
      expect(SEED.filter(r => r.note !== undefined)).toHaveLength(8)

      // ── Both clients "converge" — on the lossy state ────────────────
      expect(localRows(clientA)).toEqual(final)
      expect(localRows(clientB)).toEqual(final)
      expect(localRows(clientA)).toEqual(localRows(clientB))

      // Neither queue has anything left, so neither client has any record
      // that A's writes were ever made.
      expect(clientA.adapters.Doc.queue.getMerged()).toEqual([])
      expect(clientB.adapters.Doc.queue.getMerged()).toEqual([])

      await clientA.close()
      await clientB.close()
    }
  )

  it(
    "loses 3 of client A's 10 field-writes even to a field-merging server " +
      '[documents: lww-field-loss]',
    async () => {
      const { final, clientA, clientB } = await runConvergence('field-merge')

      // A careful backend that patches only the pushed columns preserves
      // untouched data — but it still cannot see that B's `y` is based on a
      // read that predates A's `y`.
      expect(final).toEqual([
        { id: 'r1', x: 'A-x1', y: 'A-y1', z: 'z1', note: 'n1' },
        { id: 'r2', x: 'A-x2', y: 'A-y2', z: 'z2', note: 'n2' },
        { id: 'r3', x: 'A-x3', y: 'B-y3', z: 'B-z3', note: 'n3' },
        { id: 'r4', x: 'A-x4', y: 'B-y4', z: 'B-z4', note: 'n4' },
        { id: 'r5', x: 'A-x5', y: 'B-y5', z: 'B-z5', note: 'n5' },
        { id: 'r6', x: 'x6', y: 'B-y6', z: 'B-z6', note: 'n6' },
        { id: 'r7', x: 'x7', y: 'B-y7', z: 'B-z7', note: 'n7' },
        { id: 'r8', x: 'x8', y: 'B-y8', z: 'B-z8', note: 'n8' },
      ])

      const a = measure(A_WRITES, final)
      expect(a.kept).toHaveLength(7)
      expect(a.lost).toHaveLength(3)
      // This is the floor: exactly the fields both clients wrote, lost to the
      // later pusher with no conflict raised.
      expect(describeWrites(a.lost)).toEqual(['r3.y', 'r4.y', 'r5.y'])

      // Untouched columns are safe under this policy.
      expect(final.every(r => r.note !== undefined)).toBe(true)

      const b = measure(B_WRITES, final)
      expect(b.lost).toEqual([])

      expect(localRows(clientA)).toEqual(final)
      expect(localRows(clientB)).toEqual(final)

      await clientA.close()
      await clientB.close()
    }
  )

  it('reverses the loss when the sync order reverses (pure last-writer-wins)', async () => {
    // Same edits, B first: the losses move to B, confirming the outcome is
    // decided by push order alone and not by any property of the data.
    const backend = new SharedGasBackend('field-merge')
    const clientA = await openClient(backend, 'clientA')
    const clientB = await openClient(backend, 'clientB')

    await clientA.sync.pull()
    await clientB.sync.pull()
    applyWrites(clientA, A_WRITES)
    applyWrites(clientB, B_WRITES)

    await clientB.sync.sync()
    await clientA.sync.sync()
    await clientB.sync.pull()

    const final = sortById(backend.snapshot())
    expect(measure(A_WRITES, final).lost).toEqual([])
    expect(describeWrites(measure(B_WRITES, final).lost)).toEqual(['r3.y', 'r4.y', 'r5.y'])

    await clientA.close()
    await clientB.close()
  })
})
