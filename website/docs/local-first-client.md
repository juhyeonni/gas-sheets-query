# Local-First Client

`@gsquery/client` ships a browser runtime that keeps a local copy of your tables, queues offline mutations, and syncs them to a GAS web app. You get the same `SheetsDB` API as on the server, backed by IndexedDB instead of a spreadsheet.

```
UI ──▶ SheetsDB (same API as GAS)
          │
      LocalAdapter        in-memory rows + IndexedDB persistence
          │
      MutationQueue       offline edits, merged & persisted to localStorage
          │
      SyncEngine          push / pull / conflicts / retries
          │
      SyncTransport       GasApiTransport → google.script.run or fetch
```

## Quick start

```typescript
import { createClientDB, GasApiTransport } from '@gsquery/client'
import { schema, type Tables } from './generated/client'  // from `gsquery generate --client`

const { db, sync, close } = await createClientDB<Tables>({
  schema,
  transport: new GasApiTransport(),  // google.script.run inside GAS web apps
})

// Works offline immediately — mutations are queued locally
db.from('users').create({ id: crypto.randomUUID(), name: 'John' })

// Push queued mutations, then pull server state
await sync.sync()
```

Passing a generated schema carries its `columnTypes` (so `datetime` columns hydrate as real `Date` objects after a pull) and its `indexes` into the local adapter — `ClientDBSchema` and the generated schema are the same `RuntimeSchema` type.

## `createClientDB` options

| Option | Default | Purpose |
|---|---|---|
| `schema` | — | Table definitions (`columns`, optional `sheetName`, `columnTypes`, `indexes`) |
| `transport` | — | A `SyncTransport`; use `GasApiTransport` or implement your own |
| `conflictStrategy` | `'server-wins'` | `'server-wins'` \| `'client-wins'` \| custom `(conflict) => row` |
| `pushDebounceMs` | off | Auto-push this long after the last local mutation |
| `maxRetries` | `5` | Consecutive push failures per table before dead-lettering (`0` = never) |
| `retryBaseDelayMs` / `maxRetryDelayMs` | `1000` / `60000` | Exponential backoff window for background retries |
| `onPoisonedMutation` | — | Called after `maxRetries` failures; return `'discard'`, `'retain'`, or an array of ids to drop |
| `namespace` | — | Partition key isolating IndexedDB + queue storage per instance (e.g. per team) |
| `mutationStorage` | localStorage | Custom queue persistence |
| `disableIDB` / `initialData` | — | Testing helpers: skip IndexedDB, pre-seed rows |

The result is `{ db, sync, adapters, close }`. Call `close()` on teardown — it cancels timers and closes the IndexedDB connection; pending mutations stay persisted for the next session.

## Sync behavior

- **Push before pull.** `sync.sync()` pushes each table's queued mutations, then pulls server rows. Pull rebases still-pending local mutations on top of server data, so unsynced edits are never clobbered.
- **Durable queue.** Mutations persist to localStorage at enqueue time, before any network attempt. Mutations per row are merged (insert+update → insert, insert+delete → nothing) and carry a sequence number, so edits made *while* a push is in flight are never lost. Rows that cancel out are collected once a successful push proves them settled, so `queue.hasPending` means "work still has to reach the server" and create-then-delete churn doesn't grow storage.
- **Conflicts.** When the server rejects rows, the strategy decides: `server-wins` overwrites local, `client-wins` keeps the local edit queued for re-push, and a custom resolver's merged row is re-enqueued so it reaches the server and survives the next pull.
- **Partial failures.** A transport may return `appliedIds` to state exactly which mutations it committed; without it, a failed batch clears nothing. One table's failure doesn't block other tables — `sync()` isolates per table, emits per-table `error` events, and rethrows an aggregate `SyncError`.
- **Retries and dead-lettering.** Background attempts (auto-sync, debounced pushes) back off exponentially per failing table. Explicit `sync()`/`push()`/`pull()` always run (`resetRetryState()` clears the backoff window). After `maxRetries` consecutive failures a `mutation-dead` event fires and `onPoisonedMutation` decides the fate of what is still unapplied.

### Naming the rows a push refused

A push result carries two independent lists, both optional:

```typescript
async push(tableName, mutations) {
  return {
    success: false,
    appliedIds: ['t1', 't2'],   // committed → cleared from the queue
    rejectedIds: ['t8'],        // refused   → the only rows 'discard' drops
  }
}
```

An all-or-nothing backend that throws can name them the same way, by putting a `rejectedIds` array on the thrown `Error`.

This matters when a batch is dead-lettered. `onPoisonedMutation` receives only the mutations that are **still unapplied** (rows confirmed via `appliedIds` are never reported, so you cannot re-queue a write that already landed) plus `rejectedIds` when the server named them, and may return:

| Return | Effect |
|---|---|
| `'retain'` (or nothing) | Keep everything queued and keep retrying |
| `'discard'` | Drop the named `rejectedIds` — or, if the server named none, the whole reported batch |
| `['t8', …]` | Drop exactly these ids and keep the rest queued |

Against an all-or-nothing backend that doesn't report `rejectedIds`, a bare `'discard'` therefore throws away every innocent mutation that shared the batch. Return an explicit id list (or teach the backend `rejectedIds`) to lose only the poisoned row. Discarding never touches local rows — a later pull reconciles them — and never drops writes made after the failed batch was snapshotted.

### Events

```typescript
const off = sync.on((event) => {
  // 'sync-start' | 'sync-complete' | 'sync-deferred' | 'push-complete'
  // | 'pull-complete' | 'error' (per-table or run-level) | 'mutation-dead'
})
sync.startAutoSync(30_000)  // periodic background sync
sync.stopAutoSync()
```

`sync-complete` is the "everything requested is now in sync" signal — safe to wire an *all changes saved* indicator to. It fires only when every table in the pass was actually attempted and none failed. When a background pass skips tables whose backoff window is still open, it ends in `sync-deferred` (with `deferredTables`) instead: nothing moved for those tables, so the indicator should read *retrying…* rather than turning green mid-outage. A pass with failures emits per-table `error` events and rejects with a `SyncError`, and emits neither.

## `GasApiTransport`

```typescript
new GasApiTransport()                                  // inside a GAS web app: google.script.run
new GasApiTransport({ baseUrl: 'https://...' })        // dev/browser: fetch against a REST endpoint
new GasApiTransport({ pullFn: 'syncPull', pushFn: 'syncPush' })  // GAS function names
```

The GAS side exposes `syncPull(tableName)` / `syncPush(tableName, mutations)` handlers backed by `SheetsAdapter` (typically with `idMode: 'client'`, since the browser generates IDs).

## Limitations

- **Single-tab.** Two tabs sharing a namespace can overwrite each other's queued mutations and IndexedDB snapshots. Use one tab, or give each tab its own `namespace`.
- **No protocol versioning yet.** The transport carries no per-row base version, so a server cannot detect concurrent edits on its own; the default outcome between two clients is last-write-wins.
- **Write-behind IndexedDB.** Row snapshots persist asynchronously; the mutation queue (synchronous) is the source of durability. A crash can leave the local *view* stale until the next sync, but no queued mutation is lost.
