---
description: Operational limits of Sheets-as-a-database — quotas, retry policy, script locking, cell and cache limits — and the patterns that keep them from becoming incidents.
---

# Operations

Google Sheets is a document, not a database engine, and Apps Script bills you
for every call into it. This page states the limits the library runs into, what
it already does about them, and what is left to your code — so you learn them
here rather than from an incident.

## Quotas and Rate Limits

Apps Script enforces two very different kinds of quota, worded almost
identically by the platform:

| Kind | Example platform message | Clears | Library behavior |
|------|--------------------------|--------|------------------|
| Short-term rate limit | `Service invoked too many times in a short time` | seconds | Retried with backoff |
| Daily quota | `Service invoked too many times for one day` | midnight PT | Not retried |
| Daily runtime quota | `Service using too much computer time for one day` | midnight PT | Not retried |
| Execution ceiling | `Exceeded maximum execution time` (6 min) | next execution | Not retried |

All four surface as [`QuotaExceededError`](./error-handling.md#quotaexceedederror);
its `transient` flag tells the two apart. Retrying a terminal quota inside the
same execution only burns what is left of the run, so the library does not.

**Patterns**

- Prefer `batchInsert` / `batchUpdate` / `batchDelete` / a single `query()` over
  per-row calls. Quota is consumed per Sheets API call, and a batch is one
  ranged write. `batchInsert` is one ranged write (client mode reads the id keys once per batch; auto mode reads the id column at most once per adapter instance);
  `batchUpdate` reads the id column, then only the rows from the first to the
  last matched one (`N + span*C` cells), plus one write per contiguous run of
  updated rows (worst case one per row); `batchDelete` is one id-column read
  plus one `deleteRows` per contiguous run of deleted rows.
- Single-row calls in a loop are cheap on the read side, because the adapter
  remembers where each id lives: it reads the id column once per adapter
  instance, after which `update` reads one row (`C` cells) and `delete` one id
  cell. Auto-id `insert` reads the id column at most once per instance. Every
  call still pays its own writes and two `flush()` calls, which is why a batch
  is still the better tool for many rows.
- Long jobs belong in a time-driven trigger that processes a slice per run and
  records its progress, not in one execution that races the 6-minute ceiling.
  [`runChunked`](#long-jobs-and-the-6-minute-ceiling) does the slicing.
- Catch `QuotaExceededError` and check `transient` before deciding to reschedule
  versus fail loudly.

## Long Jobs and the 6-Minute Ceiling

Apps Script kills an execution after 6 minutes, wherever it is. A single
`batchInsert` of a few thousand rows either finishes or dies mid-job, and you
cannot tell how far it got. `runChunked` splits the job into chunks, stops
cleanly before the deadline, and returns a cursor the next run resumes from.

```ts
import { runChunked } from '@gsquery/core'

const CURSOR_KEY = 'importUsers.cursor'

// Installed once as a time-driven trigger, e.g.
// ScriptApp.newTrigger('importUsers').timeBased().everyMinutes(10).create()
function importUsers() {
  const startedAt = Date.now() // first line of the handler

  const props = PropertiesService.getScriptProperties()
  const startAt = Number(props.getProperty(CURSOR_KEY) ?? 0)
  const rows = loadRowsToImport() // the same rows, in the same order, every run

  const { done } = runChunked(rows, chunk => users.batchInsert(chunk), {
    startedAt,
    startAt,
    // Save the cursor after every chunk, not only at the end.
    onChunk: ({ next }) => props.setProperty(CURSOR_KEY, String(next))
  })

  if (done) {
    props.deleteProperty(CURSOR_KEY)
    // Delete the trigger here if the job is one-off.
  }
}
```

`runChunked(items, write, options)` calls `write(chunk, offset)` once per chunk,
in input order, and returns `{ done, next, results }`. `next` is the index in
`items` to resume from (`items.length` once `done` is `true`), and `results`
holds each chunk's `write` return value. `write` can be any function:
`batchInsert`, `batchUpdate`, `batchDelete` or your own code, on any store. The
batch methods themselves are unchanged and stay all-or-nothing.

| Option | Default | Meaning |
|--------|---------|---------|
| `startedAt` | required | When this execution started (epoch ms). The library cannot see it, so capture `Date.now()` at the top of the handler |
| `budgetMs` | `330000` (5.5 min, `DEFAULT_CHUNK_BUDGET_MS`) | Time budget from `startedAt`. The default leaves headroom under the 6-minute ceiling |
| `chunkSize` | `500` (`DEFAULT_CHUNK_SIZE`) | Items per `write` call. Must be a positive integer |
| `startAt` | `0` | Index to start from: the saved cursor. Must be in `0..items.length` |
| `onChunk` | — | `({ next, result }) => void`, called after each completed chunk. Persist `next` here |

An invalid `chunkSize`, `startAt`, `startedAt` or `budgetMs` throws
`ValidationError` before `write` is ever called.

**When it stops.** No chunk starts once `startedAt + budgetMs` has been reached.
After the first chunk, no chunk starts either if the current time plus the
slowest chunk measured so far in this call would pass that deadline. The
measured time adapts to table width and quota pressure, where a fixed margin
would either waste the budget or be too small. Time spent in `onChunk` counts
toward the chunk.

**When `write` throws.** The error escapes unchanged (`QuotaExceededError`,
`LockTimeoutError`, ... exactly as documented) and no later chunk runs. Chunks
that completed earlier stay written; the cursor last reported through `onChunk`
is where the next run resumes.

**Locking.** The runner does not hold the script lock across chunks. Each
`write` takes its own lock, as the batch methods already do, so other
executions can write between chunks. Holding the lock for minutes would make
them all fail with `LockTimeoutError` after the 10-second wait.

**At-least-once, not exactly-once.** If the runtime kills the execution after a
chunk landed but before `onChunk` saved its cursor, the next run repeats that
chunk:

- In **auto id** mode, `batchInsert` inserts the repeated rows again, under new
  ids: duplicates.
- With **client ids**, `batchInsert` rejects the repeated chunk with
  [`DuplicateIdError`](./error-handling.md#duplicateiderror) and writes none of
  it. Since one `batchInsert` is a single ranged write, that chunk is already
  in the sheet: advance the saved cursor past it and run again.

Use client ids for imports that must not duplicate rows. `batchUpdate` with the
same patches is naturally safe to repeat.

## Retry Behavior

Transient backend failures — `Service Spreadsheets timed out`, `Internal error`,
`Service unavailable`, short-term rate limits — are retried automatically by the
adapter with truncated exponential backoff:

| Setting | Default | Export |
|---------|---------|--------|
| Total attempts (including the first) | `3` | `DEFAULT_RETRY_ATTEMPTS` |
| Delay before the first retry (doubles after) | `500ms` | `DEFAULT_RETRY_BASE_DELAY_MS` |
| Worst-case added latency per guarded call | `1.5s` | — |

What is deliberately **not** retried:

- **Unrecognized errors.** A logical bug retried three times is a bug with three
  times the side effects. Only messages the classifier recognizes as platform
  failures are eligible.
- **`LockTimeoutError`.** The caller already spent the full lock wait budget;
  asking again immediately just spends it twice.
- **Daily quotas and the execution ceiling.** They cannot clear inside this
  execution.
- **Shape-changing calls** — `appendRow`, `deleteRow`, `deleteRows`, `insertSheet`,
  `insertColumnBefore`, `deleteColumn`. A timeout from one of them does not say
  whether the mutation landed, so a retry risks a duplicated row or a second
  deleted column. These are classified but never repeated; losing the operation
  is recoverable, silently doubling it is not.

You can reuse the same policy around your own Sheets calls:

```ts
import { withRetries, isTransientGasError } from '@gsquery/core'

const values = withRetries(() => sheet.getRange('A1:D100').getValues())

// Or decide for yourself:
try {
  doSomething()
} catch (e) {
  if (isTransientGasError(e)) scheduleRetry()
  else throw e
}
```

Only wrap calls that are safe to repeat: `withRetries` re-runs `fn` verbatim.

## Concurrency

Apps Script runs your script concurrently for different users, so every
read-then-write sequence (find a row index, then write to that row number) must
be held inside one script lock or a concurrent execution can shift the rows out
from under it.

- Every `SheetsAdapter` write path — `insert`, `update`, `delete`,
  `batchInsert`, `batchUpdate`, migrations — already holds
  `LockService.getScriptLock()` for the whole sequence. `Repository.upsert`
  takes the lock itself, since it composes two store calls.
- The lock is **re-entrant** within an execution, so nesting (a migration
  holding the lock while the adapter writes rows) does not deadlock.
- Wait budget is **10 seconds**, and is not configurable. On expiry you get
  [`LockTimeoutError`](./error-handling.md#locktimeouterror) — and **nothing was
  written**, so the operation is safe to retry later.
- Buffered `SpreadsheetApp` writes are flushed before the lock is released, so
  the next execution never observes a half-applied write.
- Outside GAS (Node tests, browsers) `LockService` is absent and the helpers
  degrade to a plain call.

**What the lock does not give you**: transactions. Two separate calls are two
separate critical sections; there is no rollback of writes that already landed.
If several rows must change together, put them in one `batchUpdate`.

Retries sleep while holding the lock, so a guarded call can extend a lock hold
by up to 1.5s. Keep locked sections short — a scattered `batchUpdate` retries
once per contiguous run.

## Cell and Sheet Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Characters per cell | 50,000 (`MAX_CELL_LENGTH`) | Checked over the whole batch *before* the first write, so an oversized value fails the operation instead of aborting it halfway |
| Cells per spreadsheet | 10,000,000 | Enforced by Sheets; plan a rollover sheet before you approach it |

An overflow raises
[`CellSizeLimitError`](./error-handling.md#cellsizelimiterror) naming the
column, the length, and the row id. Store long text in Drive and keep the file
id in the cell.

## Read Caching and Staleness

`SheetsAdapter` snapshots the data block on first read and serves later reads of
the same execution from that snapshot — one API call instead of one per query.
The consequence is that writes made by *other* executions are invisible until:

- any write by this adapter drops the cache (an `insert` drops it even if it
  throws, e.g. `DuplicateIdError`) — unless the adapter was built with
  `patchCacheOnWrite: true`, see below, or
- you call `adapter.clearCache()`, or
- a new execution starts.

`find` and `findAll` are cached paths, and so is anything built on them
(`query()`, JOINs, aggregation). `findById` (and so `exists`) is served from the
same cache when it is warm, with no Sheets read, so it is exactly as stale as
`find`. When the cache is cold, `findById` reads just the row it needs. `update`
and `delete` never use the cache: they act on the live sheet under the script
lock.

### Id memo

Separately from the read cache, each adapter instance remembers which physical
row every id is on, and the highest numeric id. Both come only from a raw read
of the id column, survive this adapter's own writes (a successful `delete`
patches the row numbers), and are dropped by `clearCache()`, `reset()`,
`batchDelete` and a failed `deleteRow`. The remembered row is only a hint:
`update` and `delete` verify it under the lock (reading the row, or just its id
cell) and re-read the id column once when it no longer matches, so a row shifted
by another execution is never written to or deleted by mistake. The `_gsquery_meta`
counter is still read and advanced under the lock on every auto-id insert, which
is what keeps ids unique across executions. One consequence: an id a person
types into the sheet by hand during the same execution is only absorbed after
`clearCache()` or in the next execution.

Long-running triggers that poll for external edits must call `clearCache()`
between passes.

### Patching the cache on write (`patchCacheOnWrite`)

By default (`patchCacheOnWrite: false`) every write drops the cache, so a loop of
`insert` + `findAll` re-reads the whole table on every iteration. Construct the
adapter with `patchCacheOnWrite: true` and `insert`, `batchInsert`, `update`,
`batchUpdate`, `delete` and `batchDelete` instead apply what they wrote to a warm
cache, so the loop reads the table once:

```ts
const store = new SheetsAdapter<User>({
  sheetName: 'users',
  columns: ['id', 'name', 'email'],
  patchCacheOnWrite: true // default: false
})
```

The trade-off is staleness. With the option on, a write no longer refreshes the
snapshot, so rows that **other executions** wrote appear only after
`adapter.clearCache()` or in a new execution. With it off, they also appear after
this adapter's next write. Turn it on for executions that own the table while
they run (an import, a batch job); leave it off when other executions write the
same sheet and you rely on writes to pick up their rows.

A patched row is exactly what a fresh read would return: the written cells are
run back through the same deserialization (formula escaping, JSON, typed
columns), not copied from the object you passed. When that is not certain, the
write drops the cache as it does with the option off, and the next read re-reads
the table:

- a written string Sheets may parse into something else: any string containing a
  digit (`"123"`, `"007"`, `"2024-01-01"`, `"10:30"`, `"user-1"`), `true`/`false`
  in any case, a string with leading or trailing whitespace or a leading `#`;
- any value in a `date`-typed column, including a `Date`;
- with `allowFormulas: true`, a string that opens a formula (`=`, `+`, `-`, `@`,
  tab, CR) or starts with `'`;
- an `update`, `batchUpdate`, `delete` or `batchDelete` of an id that has no
  cached row (another execution inserted it after the snapshot), has several
  (a duplicate typed by hand), or that the cache holds but the sheet no longer
  does;
- a write that throws, because its outcome is unknown.

`update` and `batchUpdate` rewrite every cell of the row, so the check covers the
cells you did not change too: updating one column of a row whose other cells
hold such a string drops the cache. Plain text, numbers, booleans, `Date`s in
untyped columns, JSON array and object columns, `boolean`-typed columns, and
strings `SheetsAdapter` escapes as text are patched.

A cold cache stays cold, so a write never adds a read. `reset()` and the schema
operations (`addColumn`, `renameColumn`, `removeColumn`) always drop the cache.

## Measured Costs

Sheet calls made by `SheetsAdapter` on the data sheet, for a table with `N`
rows and `C` columns (measured with `C = 3`, ids `1..N`, read cache warm unless
stated). A *cell* is one value returned by `getValues`; `flush` is
`SpreadsheetApp.flush()`, called twice per top-level locked write.

| Operation | `getValues` calls | Cells read | Writes | `flush` | N=100 | N=1,000 | N=5,000 |
|-----------|------------------:|-----------:|--------|--------:|------:|--------:|--------:|
| `findAll`, cold (first read, or after `clearCache()`) | 2 | `N*C + C` | 0 | 0 | 303 | 3,003 | 15,003 |
| `findAll` / `find`, warm | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `findAll` after a write | 1 | `N*C` | 0 | 0 | 300 | 3,000 | 15,000 |
| `findAll` after a patched write (`patchCacheOnWrite: true`, cache was warm) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `findById`, cache warm | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `count`, cache warm | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `count` after a write (cache cold, header verified) | 1 | `N` | 0 | 0 | 100 | 1,000 | 5,000 |
| `count` after `clearCache()` | 2 | `C + N` | 0 | 0 | 103 | 1,003 | 5,003 |
| `findById` after `clearCache()` (cache and id map cold, header re-checked) | 3 | `C + N + C` | 0 | 0 | 106 | 1,006 | 5,006 |
| `findById`, cache cold, id map warm | 1 | `C` | 0 | 0 | 3 | 3 | 3 |
| `insert` (auto id), first in the instance | 1 | `N` | 1 `appendRow` | 2 | 100 | 1,000 | 5,000 |
| `insert` (auto id), later calls | 0 | 0 | 1 `appendRow` | 2 | 0 | 0 | 0 |
| `insert` (client id), every call | 1 | current row count | 1 `appendRow` | 2 | 100 | 1,000 | 5,000 |
| `update`, first in the instance | 2 | `N + C` | 1 `setValues` | 2 | 103 | 1,003 | 5,003 |
| `update`, later calls | 1 | `C` | 1 `setValues` | 2 | 3 | 3 | 3 |
| `update`, stale hint (another execution moved the row) | 3 | `C + N + C` | 1 `setValues` | 2 | 106 | 1,006 | 5,006 |
| `delete`, first in the instance | 1 | `N` | 1 `deleteRow` | 2 | 100 | 1,000 | 5,000 |
| `delete`, later calls | 1 | 1 | 1 `deleteRow` | 2 | 1 | 1 | 1 |
| `delete`, stale hint | 2 | `1 + N` | 1 `deleteRow` | 2 | 101 | 1,001 | 5,001 |
| `batchInsert` of 100 rows | 1 | `N` | 1 `setValues` | 2 | 100 | 1,000 | 5,000 |
| `batchUpdate` of 1 id | 2 | `N + C` | 1 `setValues` | 2 | 103 | 1,003 | 5,003 |
| `batchUpdate` of 100 contiguous ids | 2 | `N + 100*C` | 1 `setValues` | 2 | 400 | 1,300 | 5,300 |
| `batchUpdate` of 10 scattered ids (ids `1,3,...,19`, span 19 rows) | 2 | `N + 19*C` | 10 `setValues` | 2 | 157 | 1,057 | 5,057 |
| `batchDelete` of 100 contiguous ids | 1 | `N` | 1 `deleteRows` | 2 | 100 | 1,000 | 5,000 |
| `batchDelete` of 10 scattered ids | 1 | `N` | 10 `deleteRows` | 2 | 100 | 1,000 | 5,000 |

A loop of M auto-id inserts into an N-row sheet therefore reads `N` cells once
instead of `M*N + M(M-1)/2` (for N = 1,000 and M = 1,000 that is 1,000 instead
of 1,499,500), and a loop of M updates reads `N + M*C`.

`batchUpdate` reads the id column, then one block spanning the first to the last
matched row; rows in between are read but never written. When the first and last
rows are both updated the span is the whole table, so it reads `N + N*C` cells
(`N` more than a single full read). Both reads are retried on transient failures.

`count()` is the number of rows with a non-empty id cell, which is what
`repo.count()` returns on SheetsAdapter. A row with a blank id (for example one
typed in by hand) is returned by `findAll` but not counted. A warm cache answers
with no read; otherwise it reads the id column once and does not fill the cache.

These numbers are call and cell counts, not timings. They are pinned by
`packages/core/tests/unit/sheets-adapter-documented-costs.test.ts`, so CI fails
if a change to the adapter alters them; such a change must update this table in
the same commit. They count data-sheet calls only (the auto-id counter on the
`_gsquery_meta` sheet is excluded), and real GAS per-call latency is not
measured.

## Checklist Before Going to Production

- Writes go through batch APIs, not per-row loops.
- Long jobs are sliced across time-driven trigger runs with `runChunked`, and
  the cursor is saved from `onChunk`.
- `QuotaExceededError` (check `transient`) and `LockTimeoutError` are caught and
  rescheduled rather than surfaced as generic failures.
- Values that can grow unbounded are kept out of cells.
- Anything polling for external edits calls `clearCache()`.
- The sheet's column layout is treated as schema: a manual column insert breaks
  the positional mapping and raises `SchemaMismatchError`.

## See Also

- [Error Handling](./error-handling.md) — every typed error and its code
- [Batch Operations](./batch-operations.md)
- [Indexing and Performance](./indexing-and-performance.md)
- [Migration System](./migration-system.md)
