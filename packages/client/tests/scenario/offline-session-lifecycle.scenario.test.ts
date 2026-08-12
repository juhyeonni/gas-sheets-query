/**
 * S5 — Offline session lifecycle (production scenario).
 *
 * One realistic user session driven end-to-end through `createClientDB`:
 *
 *   pull initial data → go offline → 15 mixed mutations → backoff while the
 *   network is down → page reload (new createClientDB over the SAME mutation
 *   storage) → come back online → sync → converge with the server.
 *
 * plus the poisoned-mutation path (a row the backend permanently refuses)
 * exercised through the public `onPoisonedMutation` hook rather than against
 * SyncEngine directly.
 *
 * IndexedDB is disabled (Node), so only the MutationQueue survives the
 * "reload" — that is deliberate: it isolates the queue's durability, which is
 * the thing an offline session depends on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { createClientDB } from '../../src/local/create-client-db.js'
import type { ClientDBResult, ClientDBSchema } from '../../src/local/create-client-db.js'
import { MockTransport } from '../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  PoisonedMutationAction,
  PoisonedMutationInfo,
  RejectedMutationIds,
  SyncEvent,
  SyncPushResult,
  SyncTransport,
} from '../../src/local/sync-transport.js'

interface Task extends RowWithId {
  id: string
  title: string
  status: string
  priority: number
}

type Tables = { Task: Task }

const schema: ClientDBSchema = {
  tables: {
    Task: { columns: ['id', 'title', 'status', 'priority'] },
  },
}

/** Server state the session starts from. */
const SEED: Task[] = [
  { id: 't1', title: 'Task 1', status: 'todo', priority: 1 },
  { id: 't2', title: 'Task 2', status: 'todo', priority: 2 },
  { id: 't3', title: 'Task 3', status: 'todo', priority: 3 },
  { id: 't4', title: 'Task 4', status: 'todo', priority: 4 },
  { id: 't5', title: 'Task 5', status: 'todo', priority: 5 },
]

/**
 * The deterministic outcome of the 15 offline edits below, once they reach the
 * server. Also the state both the server and the local store must end in.
 */
const CONVERGED: Task[] = [
  { id: 't1', title: 'Task 1', status: 'done', priority: 1 },
  { id: 't2', title: 'Task 2 edited', status: 'todo', priority: 20 },
  { id: 't4', title: 'Task 4 renamed', status: 'todo', priority: 40 },
  { id: 't6', title: 'Task 6', status: 'doing', priority: 6 },
  { id: 't8', title: 'Task 8', status: 'todo', priority: 8 },
  { id: 't9', title: 'Task 9 edited', status: 'todo', priority: 9 },
]

/** `CONVERGED` minus t8, i.e. the outcome when the backend refuses t8. */
const CONVERGED_WITHOUT_T8 = CONVERGED.filter(t => t.id !== 't8')

/** Merged form of the 15 raw mutations, in the queue's first-seen order. */
const EXPECTED_MERGED: MergedMutation<Task>[] = [
  { id: 't1', type: 'update', data: { status: 'done' } },
  { id: 't2', type: 'update', data: { priority: 20, title: 'Task 2 edited' } },
  { id: 't6', type: 'insert', data: { id: 't6', title: 'Task 6', status: 'doing', priority: 6 } },
  { id: 't3', type: 'delete', data: undefined },
  { id: 't8', type: 'insert', data: { id: 't8', title: 'Task 8', status: 'todo', priority: 8 } },
  { id: 't4', type: 'update', data: { title: 'Task 4 renamed', priority: 40 } },
  { id: 't5', type: 'delete', data: undefined },
  { id: 't9', type: 'insert', data: { id: 't9', title: 'Task 9 edited', status: 'todo', priority: 9 } },
]

/** In-memory MutationStorage that outlives a `createClientDB` instance. */
function createPersistentStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

/**
 * A network link in front of a MockTransport "server".
 *
 * Models the two things a real Apps Script deployment does that MockTransport
 * alone cannot: it can be unreachable, and it can permanently refuse
 * individual rows (a validation rule on the sheet). Two refusal styles are
 * supported, both of which real `syncPush` handlers are written in the wild:
 *
 * - `partial-commit` — commit what is valid, report the rest via the
 *   documented `appliedIds` contract with `success: false`.
 * - `all-or-nothing` — reject the whole batch (the naive implementation).
 *
 * `namesOffenders` upgrades either style to the `rejectedIds` contract, i.e. a
 * handler that says *which* rows it refused rather than only that it refused.
 */
class GasBackendLink implements SyncTransport {
  online = true
  rejectionMode: 'partial-commit' | 'all-or-nothing' = 'partial-commit'
  namesOffenders = false
  readonly rejectedIds = new Set<string>()
  readonly pushAttempts: Array<{ table: string; ids: (string | number)[] }> = []
  readonly pullAttempts: string[] = []

  constructor(private readonly server: MockTransport) {}

  async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    this.pullAttempts.push(tableName)
    this.assertReachable()
    return this.server.pull<T>(tableName)
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.pushAttempts.push({ table: tableName, ids: mutations.map(m => m.id) })
    this.assertReachable()

    const refused = mutations.filter(m => this.rejectedIds.has(String(m.id)))
    if (refused.length === 0) {
      return this.server.push(tableName, mutations)
    }

    if (this.rejectionMode === 'all-or-nothing') {
      const error: Error & RejectedMutationIds = new Error(
        `syncPush: validation failed for ${refused.map(m => m.id).join(', ')} — batch rejected`
      )
      if (this.namesOffenders) error.rejectedIds = refused.map(m => m.id)
      throw error
    }

    const accepted = mutations.filter(m => !this.rejectedIds.has(String(m.id)))
    if (accepted.length > 0) {
      await this.server.push(tableName, accepted)
    }
    return {
      success: false,
      appliedIds: accepted.map(m => m.id),
      rejectedIds: this.namesOffenders ? refused.map(m => m.id) : undefined,
    }
  }

  pushAttemptCount(): number {
    return this.pushAttempts.length
  }

  private assertReachable(): void {
    if (!this.online) {
      throw new Error('NetworkError: failed to reach the Apps Script web app')
    }
  }
}

function sortById<T extends RowWithId>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function serverRows(server: MockTransport): Task[] {
  return sortById((server.serverData.get('Task') ?? []) as Task[])
}

/**
 * The 15 raw offline actions, including two same-row sequences (t1, t4), an
 * insert-then-edit (t6, t9) and an insert-then-delete that cancels out (t7).
 */
function applyOfflineEdits(session: ClientDBResult<Tables>): void {
  const tasks = session.db.from('Task')

  tasks.update('t1', { status: 'doing' }) //  1
  tasks.update('t1', { status: 'done' }) //  2  same row again
  tasks.update('t2', { priority: 20 }) //  3
  tasks.create({ id: 't6', title: 'Task 6', status: 'todo', priority: 6 }) //  4
  tasks.update('t6', { status: 'doing' }) //  5  edit of an unsynced insert
  tasks.create({ id: 't7', title: 'Task 7', status: 'todo', priority: 7 }) //  6
  tasks.delete('t7') //  7  cancels out with 6
  tasks.delete('t3') //  8
  tasks.create({ id: 't8', title: 'Task 8', status: 'todo', priority: 8 }) //  9
  tasks.update('t4', { title: 'Task 4 renamed' }) // 10
  tasks.update('t4', { priority: 40 }) // 11  same row again
  tasks.delete('t5') // 12
  tasks.create({ id: 't9', title: 'Task 9', status: 'todo', priority: 9 }) // 13
  tasks.update('t9', { title: 'Task 9 edited' }) // 14
  tasks.update('t2', { title: 'Task 2 edited' }) // 15  same row as 3
}

describe('S5 offline session lifecycle', () => {
  let server: MockTransport
  let storage: MutationStorage

  beforeEach(() => {
    server = new MockTransport()
    server.setServerData<Task>('Task', SEED)
    storage = createPersistentStorage()
  })

  function openSession(
    link: GasBackendLink,
    options: {
      maxRetries?: number
      retryBaseDelayMs?: number
      onPoisonedMutation?: (info: PoisonedMutationInfo) => PoisonedMutationAction | void
    } = {}
  ): Promise<ClientDBResult<Tables>> {
    return createClientDB<Tables>({
      schema,
      transport: link,
      disableIDB: true,
      mutationStorage: storage,
      ...options,
    })
  }

  it('survives going offline, a reload and coming back online', async () => {
    const link = new GasBackendLink(server)

    // ── Session 1: online, load the working set ───────────────────────
    const session1 = await openSession(link, { maxRetries: 0, retryBaseDelayMs: 1000 })
    await session1.sync.pull()
    expect(session1.db.from('Task').findAll()).toEqual(SEED)

    // ── Go offline and keep working ───────────────────────────────────
    const pullsWhileOnline = link.pullAttempts.length
    expect(pullsWhileOnline).toBe(1)
    link.online = false
    applyOfflineEdits(session1)

    const queue1 = session1.adapters.Task.queue
    expect(queue1.length).toBe(15)
    expect(queue1.getMerged()).toEqual(EXPECTED_MERGED)

    // The UI still shows a consistent, fully-edited view while offline.
    expect(sortById(session1.db.from('Task').findAll())).toEqual(CONVERGED)

    // ── Backoff: repeated auto-sync ticks do not hammer a dead server ─
    vi.useFakeTimers()
    try {
      const events: SyncEvent[] = []
      session1.sync.on(e => events.push(e))
      session1.sync.startAutoSync(200)

      // Ticks at 200/400/600/800/1000 — only the first attempt gets through;
      // the rest fall inside the 1000ms window opened by that failure.
      await vi.advanceTimersByTimeAsync(1000)
      expect(link.pushAttemptCount()).toBe(1)

      // The tick at 1200 is past the deadline, so exactly one retry lands.
      await vi.advanceTimersByTimeAsync(300)
      expect(link.pushAttemptCount()).toBe(2)

      session1.sync.stopAutoSync()

      // The failure was reported, not swallowed...
      expect(events.some(e => e.type === 'error' && e.table === 'Task')).toBe(true)
      // ...and a failed push never lets a pull clobber the offline edits:
      // sync() aborts the table before its pull phase.
      expect(link.pullAttempts).toHaveLength(pullsWhileOnline)
      // Nothing was ever accepted by the server during the outage.
      expect(events.some(e => e.type === 'push-complete')).toBe(false)
    } finally {
      vi.useRealTimers()
    }

    // Nothing was lost while the network was down.
    expect(queue1.length).toBe(15)
    expect(queue1.getMerged()).toEqual(EXPECTED_MERGED)
    expect(sortById(session1.db.from('Task').findAll())).toEqual(CONVERGED)

    // ── "Page reload": new client over the same storage and server ────
    await session1.close()
    const link2 = new GasBackendLink(server)
    const session2 = await openSession(link2, { maxRetries: 0, retryBaseDelayMs: 1000 })
    const queue2 = session2.adapters.Task.queue

    // The pending work survived the reload, merge semantics intact.
    expect(queue2.length).toBe(15)
    expect(queue2.getMerged()).toEqual(EXPECTED_MERGED)

    // With IndexedDB off, the *rows* did not survive — only the queue did, so
    // the reloaded page renders empty until the first sync.
    expect(session2.db.from('Task').findAll()).toEqual([])

    // ── Back online: sync and converge ────────────────────────────────
    await session2.sync.sync()

    expect(serverRows(server)).toEqual(CONVERGED)
    expect(sortById(session2.db.from('Task').findAll())).toEqual(CONVERGED)
    // local === server, field for field.
    expect(sortById(session2.db.from('Task').findAll())).toEqual(serverRows(server))

    // The server saw exactly one batch, containing exactly the merged set.
    expect(server.pushHistory).toHaveLength(1)
    expect(server.pushHistory[0].mutations).toEqual(EXPECTED_MERGED)

    // Everything that could be pushed has been pushed.
    expect(queue2.getMerged()).toEqual([])

    await session2.close()
  })

  it(
    'defers, and never completes, a pass whose only table was skipped by backoff ' +
      '[regression: #173 backoff-emits-false-sync-complete]',
    async () => {
      const link = new GasBackendLink(server)
      const session = await openSession(link, { maxRetries: 0, retryBaseDelayMs: 1000 })
      await session.sync.pull()

      link.online = false
      applyOfflineEdits(session)

      vi.useFakeTimers()
      try {
        const events: SyncEvent[] = []
        session.sync.on(e => events.push(e))
        session.sync.startAutoSync(200)

        // Five ticks (200/400/600/800/1000). The first attempts the push and
        // fails, opening a 1000ms backoff window; the other four skip the
        // table entirely.
        await vi.advanceTimersByTimeAsync(1000)
        session.sync.stopAutoSync()

        expect(link.pushAttemptCount()).toBe(1)
        expect(events.filter(e => e.type === 'error' && e.table === 'Task')).toHaveLength(1)

        // A pass in which every table was skipped has no recorded failures,
        // but it is not a completed sync either: an "all changes saved"
        // indicator wired to `sync-complete` must stay grey for the whole
        // outage, with 15 mutations still unsent.
        expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(0)

        // The four skipped passes announce themselves as deferred instead, so a
        // UI can show "retrying..." and name the tables still waiting.
        const deferred = events.filter(e => e.type === 'sync-deferred')
        expect(deferred).toHaveLength(4)
        expect(deferred.every(e => e.deferredTables?.includes('Task'))).toBe(true)

        // Those passes moved nothing in either direction.
        expect(events.filter(e => e.type === 'push-complete')).toHaveLength(0)
        expect(events.filter(e => e.type === 'pull-complete')).toHaveLength(0)
        expect(session.adapters.Task.queue.getMerged()).toEqual(EXPECTED_MERGED)
      } finally {
        vi.useRealTimers()
      }

      await session.close()
    }
  )

  it(
    'purges mutations that cancelled each other out ' +
      '[regression: #175 cancelled-mutations-never-purged]',
    async () => {
      const link = new GasBackendLink(server)
      const session = await openSession(link)
      await session.sync.pull()
      applyOfflineEdits(session)
      await session.sync.sync()

      const queue = session.adapters.Task.queue

      // There is genuinely nothing left to send...
      expect(queue.getMerged()).toEqual([])
      expect(serverRows(server)).toEqual(CONVERGED)

      // ...and nothing left in the queue either. The two raw mutations for t7
      // (insert then delete, which merge to a no-op) have no id in the merged
      // batch, so the push-driven clear cannot see them — they are collected
      // separately, once the push boundary proves them dead.
      expect(queue.length).toBe(0)

      // So `hasPending` answers the question an app actually asks it: is there
      // work that still has to reach the server? Safe to close this tab.
      expect(queue.hasPending).toBe(false)

      // Nothing is left behind in localStorage either — create-then-delete
      // churn no longer grows the key without bound.
      expect(storage.getItem('gsquery:Task:mutations')).toBeNull()

      // A cancelled pair enqueued *after* the sync is still pending work as far
      // as durability goes, and is collected by the next push boundary.
      const tasks = session.db.from('Task')
      tasks.create({ id: 't10', title: 'Task 10', status: 'todo', priority: 10 })
      tasks.delete('t10')
      expect(queue.length).toBe(2)
      expect(queue.hasPending).toBe(false) // ...but it is not work to send

      await session.sync.sync()
      expect(queue.length).toBe(0)
      expect(serverRows(server)).toEqual(CONVERGED)

      await session.close()
    }
  )

  it('dead-letters a permanently-refused row and syncs the rest cleanly', async () => {
    const link = new GasBackendLink(server)
    link.rejectedIds.add('t8') // a sheet validation rule refuses this row

    const poisoned: PoisonedMutationInfo[] = []
    const events: SyncEvent[] = []
    const session = await openSession(link, {
      maxRetries: 2,
      retryBaseDelayMs: 0,
      onPoisonedMutation: info => {
        poisoned.push(info)
        return 'discard'
      },
    })
    session.sync.on(e => events.push(e))

    await session.sync.pull()
    link.online = false
    applyOfflineEdits(session)
    link.online = true

    // Attempt 1: the backend commits the 7 valid rows and refuses t8.
    await expect(session.sync.sync()).rejects.toThrow(/Sync failed for 1 table/)
    expect(poisoned).toHaveLength(0) // one refusal is not poison yet
    expect(session.adapters.Task.queue.getMerged().map(m => m.id)).toEqual(['t8'])
    expect(serverRows(server)).toEqual(CONVERGED_WITHOUT_T8)

    // Attempt 2: t8 is refused again, hitting maxRetries.
    await expect(session.sync.sync()).rejects.toThrow(/Sync failed for 1 table/)

    expect(poisoned).toHaveLength(1)
    expect(poisoned[0].table).toBe('Task')
    expect(poisoned[0].attempts).toBe(2)
    expect(poisoned[0].mutations.map(m => m.id)).toEqual(['t8'])
    expect(poisoned[0].error.message).toContain('server reported failure without conflicts')

    const dead = events.filter(e => e.type === 'mutation-dead')
    expect(dead).toHaveLength(1)
    expect(dead[0].mutations?.map(m => m.id)).toEqual(['t8'])

    // The handler discarded it, so the table is unblocked.
    expect(session.adapters.Task.queue.getMerged()).toEqual([])

    // Attempt 3: a clean, complete sync — everything except t8 converged.
    await expect(session.sync.sync()).resolves.toBeUndefined()
    expect(serverRows(server)).toEqual(CONVERGED_WITHOUT_T8)
    expect(sortById(session.db.from('Task').findAll())).toEqual(CONVERGED_WITHOUT_T8)
    expect(events.some(e => e.type === 'sync-complete')).toBe(true)

    // The discarded row is gone from the local view too: the pull that follows
    // the unblocked push replaces local state with the server's, and the app is
    // never told which row vanished beyond the one `mutation-dead` event.
    expect(session.db.from('Task').repo.findByIdOrNull('t8')).toBeUndefined()

    await session.close()
  })

  it(
    'discards only the poisoned mutation the handler names, keeping the innocent ones ' +
      '[regression: #174 poison-discard-drops-whole-batch]',
    async () => {
      const link = new GasBackendLink(server)
      // The naive Apps Script handler: one invalid row rejects the whole batch,
      // and it does not say which row that was.
      link.rejectionMode = 'all-or-nothing'
      link.rejectedIds.add('t8')

      const poisoned: PoisonedMutationInfo[] = []
      const session = await openSession(link, {
        maxRetries: 1,
        retryBaseDelayMs: 0,
        onPoisonedMutation: info => {
          poisoned.push(info)
          // The app knows the sheet's validation rule (or parses the error) and
          // names the single offender instead of sacrificing the batch.
          return [/t8/.test(info.error.message) ? 't8' : '']
        },
      })

      await session.sync.pull()
      link.online = false
      applyOfflineEdits(session)
      link.online = true

      await expect(session.sync.sync()).rejects.toThrow(/Sync failed for 1 table/)

      // The report still shows the whole unapplied batch — with an
      // all-or-nothing backend nothing was committed, so all 8 are genuinely
      // still pending — and the backend named no offender.
      expect(poisoned).toHaveLength(1)
      expect(poisoned[0].mutations.map(m => m.id)).toEqual([
        't1',
        't2',
        't6',
        't3',
        't8',
        't4',
        't5',
        't9',
      ])
      expect(poisoned[0].rejectedIds).toBeUndefined()

      // Returning a list drops exactly those ids. The 7 innocent merged
      // mutations — 12 of the user's 15 raw offline actions — stay queued.
      expect(session.adapters.Task.queue.getMerged().map(m => m.id)).toEqual([
        't1',
        't2',
        't6',
        't3',
        't4',
        't5',
        't9',
      ])

      // Nothing reached the server yet, but the table is unblocked, so the very
      // next sync lands the whole offline session except the refused row.
      expect(serverRows(server)).toEqual(SEED)
      await expect(session.sync.sync()).resolves.toBeUndefined()
      expect(serverRows(server)).toEqual(CONVERGED_WITHOUT_T8)
      expect(sortById(session.db.from('Task').findAll())).toEqual(CONVERGED_WITHOUT_T8)

      await session.close()
    }
  )

  it(
    "discards only the ids an all-or-nothing backend names in its error " +
      '[regression: #174]',
    async () => {
      const link = new GasBackendLink(server)
      link.rejectionMode = 'all-or-nothing'
      // The upgraded Apps Script handler: still all-or-nothing, but it reports
      // which rows its validation refused, per the `rejectedIds` contract.
      link.namesOffenders = true
      link.rejectedIds.add('t8')

      const poisoned: PoisonedMutationInfo[] = []
      const session = await openSession(link, {
        maxRetries: 1,
        retryBaseDelayMs: 0,
        onPoisonedMutation: info => {
          poisoned.push(info)
          return 'discard'
        },
      })

      await session.sync.pull()
      link.online = false
      applyOfflineEdits(session)
      link.online = true

      await expect(session.sync.sync()).rejects.toThrow(/Sync failed for 1 table/)

      // The engine surfaces the named offenders, so a plain 'discard' is now
      // precise: it drops t8 and nothing else.
      expect(poisoned[0].rejectedIds).toEqual(['t8'])
      expect(session.adapters.Task.queue.getMerged().map(m => m.id)).not.toContain('t8')
      expect(session.adapters.Task.queue.getMerged()).toHaveLength(7)

      await expect(session.sync.sync()).resolves.toBeUndefined()
      expect(serverRows(server)).toEqual(CONVERGED_WITHOUT_T8)

      await session.close()
    }
  )

  it(
    'reports only the still-unapplied rows in the poisoned batch ' +
      '[regression: #176 dead-letter-reports-applied-mutations]',
    async () => {
      const link = new GasBackendLink(server)
      link.rejectedIds.add('t8')

      const poisoned: PoisonedMutationInfo[] = []
      const events: SyncEvent[] = []
      const session = await openSession(link, {
        maxRetries: 1, // dead-letter on the very first refusal
        retryBaseDelayMs: 0,
        onPoisonedMutation: info => {
          poisoned.push(info)
          return 'retain'
        },
      })
      session.sync.on(e => events.push(e))

      await session.sync.pull()
      link.online = false
      applyOfflineEdits(session)
      link.online = true

      await expect(session.sync.sync()).rejects.toThrow(/Sync failed for 1 table/)

      // The backend committed 7 of the 8 rows and said so via `appliedIds`,
      // and the queue was cleared accordingly...
      expect(serverRows(server)).toEqual(CONVERGED_WITHOUT_T8)
      expect(session.adapters.Task.queue.getMerged().map(m => m.id)).toEqual(['t8'])

      // ...and the dead-letter report agrees with the queue: it names only the
      // row that is still unapplied. An app that logs or re-queues
      // `info.mutations` for manual repair acts on exactly the failed write.
      expect(poisoned).toHaveLength(1)
      expect(poisoned[0].mutations.map(m => m.id)).toEqual(['t8'])
      expect(poisoned[0].mutations[0].data).toMatchObject({ title: 'Task 8' })

      // The same payload reaches the event listener.
      const dead = events.filter(e => e.type === 'mutation-dead')
      expect(dead).toHaveLength(1)
      expect(dead[0].mutations?.map(m => m.id)).toEqual(['t8'])

      await session.close()
    }
  )
})
