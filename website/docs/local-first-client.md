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
- **Durable queue.** Mutations persist to localStorage at enqueue time, before any network attempt. Mutations per row are merged (insert+update → insert, insert+delete → nothing) and carry a sequence number, so edits made *while* a push is in flight are never lost. Consecutive updates of one row compact into a single entry, and batch writes persist once. If storage rejects a write (for example a full quota), the write call throws; the change stays applied in memory and will still sync. Rows that cancel out are collected once a successful push proves them settled, so `queue.hasPending` means "work still has to reach the server" and create-then-delete churn doesn't grow storage.
- **Conflicts.** When the server rejects rows, the strategy decides: `server-wins` overwrites local, `client-wins` keeps the local edit queued for re-push, and a custom resolver's merged row is re-enqueued so it reaches the server and survives the next pull.
- **Partial failures.** A transport may return `appliedIds` to state exactly which mutations it committed; without it, a failed batch clears nothing. One table's failure doesn't block other tables — `sync()` isolates per table, emits per-table `error` events, and rethrows an aggregate `SyncError`.
- **Retries and dead-lettering.** Background attempts (auto-sync, debounced pushes) back off exponentially per failing table. Explicit `sync()`/`push()`/`pull()` always run (`resetRetryState()` clears the backoff window). After `maxRetries` consecutive failures a `mutation-dead` event fires and `onPoisonedMutation` decides the fate of what is still unapplied.
- **Overlapping `sync()` calls.** A `sync()` called while another pass is running waits for one extra pass that starts after it, so writes made since the running pass began are pushed before it resolves. Every call for the same scope (`sync()` or `sync('table')`) arriving before that extra pass starts shares it, and rejects if it fails. Auto-sync ticks skip while a pass is running.
- **`isSyncing`** is `true` from the moment any `sync()`, `push()` or `pull()` — explicit or background — is called until every started operation has settled.

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

| Option | Default | Purpose |
|---|---|---|
| `baseUrl` | — | Use `fetch` against this URL instead of `google.script.run` (outside GAS, `/api` when omitted) |
| `pullFn` / `pushFn` | `'syncPull'` / `'syncPush'` | GAS function names for the `google.script.run` path |
| `pushContentType` | `'text/plain'` on `script.google.com`, else `'application/json'` | `Content-Type` of the push request; the body is JSON either way |
| `timeoutMs` | `60000` | Abort a `fetch` request after this many ms (`0` = no timeout) |
| `context` | — | Fixed routing metadata sent on every pull and push (see [Routing context](#routing-context)) |

With `baseUrl`, pull sends `GET <baseUrl>/sync/pull?table=<name>` and expects `{ rows: [...] }`; push sends `POST <baseUrl>/sync/push` with the JSON body `{ table, mutations }` and expects a push result with a boolean `success`. A response of any other shape is rejected with an error naming the operation and table.

`syncPush` receives the mutations JSON-encoded, the same on both paths: `datetime` values arrive as ISO-8601 strings (`Date.prototype.toISOString()`), whether the push went over `google.script.run` or the REST endpoint, and keys whose value is `undefined` are absent. (`google.script.run` rejects any parameter holding a `Date`, so the transport encodes before calling it.) `SheetsAdapter` stores such strings correctly, and the local rows and queue keep their `Date` objects — only the wire form changes.

### Calling a deployed GAS web app with `baseUrl`

`baseUrl` can be a deployed web app's `/exec` URL, so a page on another origin can sync through `fetch`:

```typescript
new GasApiTransport({ baseUrl: 'https://script.google.com/macros/s/<deployment-id>/exec' })
```

GAS web apps do not answer CORS preflight requests, and a `Content-Type: application/json` POST needs one, so the request would fail in the browser before reaching your script. On a `script.google.com` URL the transport therefore sends the push as `Content-Type: text/plain` with the JSON in the body, which needs no preflight. Your `doPost` reads the body as text and parses it; the operation arrives in `e.pathInfo`:

```javascript
// Code.gs
function doGet(e) {
  if (e.pathInfo === 'sync/pull') return json(syncPull(e.parameter.table))
  return json({ error: 'not found' })
}

function doPost(e) {
  if (e.pathInfo === 'sync/push') {
    const { table, mutations } = JSON.parse(e.postData.contents)
    return json(syncPush(table, mutations))
  }
  return json({ error: 'not found' })
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON)
}
```

Set `pushContentType` to override the choice: `'application/json'` for a proxy in front of GAS that needs it, or `'text/plain'` for another server with the same CORS limitation. A dev server that only parses JSON bodies keeps working unchanged, since any other host defaults to `'application/json'`.

Deploy the web app with access set so that the browser's requests reach it (for a cross-origin page, typically "Anyone"). When access is narrower, GAS answers with a sign-in or error **HTML page with HTTP status 200**; the transport rejects such a response with an error saying GAS returned an HTML page and to check the deployment's access settings, rather than failing to parse it as JSON.

### Timeouts and retries

A `fetch` request that has not completed within `timeoutMs` is aborted and rejects with an error saying it timed out and after how many ms; without it, a hung connection would block every later sync operation. The `google.script.run` path has no timeout: it cannot be cancelled, and GAS fails it at its execution limit.

The transport never retries. A failed request rejects once, and `SyncEngine` owns retries: background attempts back off per table, and dead-lettering counts each push failure exactly once.

### Routing context

When one backend serves several spreadsheets (for example one per team), the server has to know which one a sync request is for. Pass a `context` and the transport sends it on every pull and push:

```typescript
const transport = new GasApiTransport({ context: { tenant: 'team-a' } })
```

`context` is a `Record<string, string>` captured once, when the transport is constructed. Build one transport per client instance; to switch tenants, `close()` the old client and create a new one with a new transport. The library treats the context as opaque: it never reads the keys or values.

How it travels, on each path:

| Path | Pull | Push |
|---|---|---|
| GAS (`google.script.run`) | `syncPull(table, context)` | `syncPush(table, mutations, context)` |
| REST (`fetch`) | `GET …/sync/pull?table=<table>&<key>=<value>…` | `POST …/sync/push?<key>=<value>…`, body `{ table, mutations }` |

Without a `context` the calls are unchanged: no trailing argument, no extra query parameters. REST keys and values are URL-encoded. A `table` key is rejected at construction because it collides with the pull URL's `table` parameter. Empty-string values are sent as they are.

**`context` vs `namespace`.** `namespace` (on `createClientDB`) partitions *local* storage: IndexedDB and the mutation queue. `context` is *server-routing* metadata. They are separate concepts, even when an app binds both to the same tenant id.

**Security.** Carry a validated identifier the server authorizes, never a resolved resource id such as a spreadsheetId. The server checks that the caller may use that tenant, then maps it to the spreadsheet itself; a client that names a spreadsheet directly can name any spreadsheet. Query parameters appear in access logs, so the context must never hold secrets or tokens.

A server handler that reads the context on both paths:

```typescript
// GAS: google.script.run passes the context as the trailing argument
function syncPull(table: string, context?: { tenant?: string }) {
  return { rows: dbFor(context?.tenant).from(table).findAll() }
}

// REST: doGet / doPost cannot read headers, so the context is in e.parameter
function doGet(e: GoogleAppsScript.Events.DoGet) {
  return json(syncPull(e.parameter.table, { tenant: e.parameter.tenant }))
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
  const { table, mutations } = JSON.parse(e.postData.contents)
  return json(syncPush(table, mutations, { tenant: e.parameter.tenant }))
}

function json(body: unknown) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON)
}

// Validate, then resolve: never trust a spreadsheet id from the client
function dbFor(tenant: string | undefined) {
  const user = Session.getActiveUser().getEmail()
  const spreadsheetId = lookupSpreadsheetFor(user, tenant)  // throws if not a member
  return createSheetsDB({ spreadsheetId, tables })
}
```

### Overriding the transport

`gasPull`, `gasPush`, `fetchPull` and `fetchPush` are `protected`, and `GasApiTransport.isGas()` is a `protected static` method, so a subclass can change one call path and keep the rest:

```typescript
class LoggingTransport extends GasApiTransport {
  protected override async fetchPull<T extends RowWithId>(table: string) {
    console.debug('pull', table, GasApiTransport.isGas())
    return super.fetchPull<T>(table)
  }
}
```

`pull` and `push` call the overridden methods.

## Limitations

- **Single-tab.** Two tabs sharing a namespace can overwrite each other's queued mutations and IndexedDB snapshots. Use one tab, or give each tab its own `namespace`.
- **No protocol versioning yet.** The transport carries no per-row base version, so a server cannot detect concurrent edits on its own; the default outcome between two clients is last-write-wins.
- **Write-behind IndexedDB.** Row snapshots persist asynchronously; the mutation queue (synchronous) is the source of durability. A crash can lose the latest snapshot write, but no queued mutation is lost: on reload, each table's view is rebuilt from the IndexedDB snapshot plus the queued mutations, and the rebuilt view is written back to IndexedDB. If IndexedDB cannot be opened, every table runs in memory for that session (the queue still persists) and its view comes from the next sync.
