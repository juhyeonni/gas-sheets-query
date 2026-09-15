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

- Prefer `batchInsert` / `batchUpdate` / a single `query()` over per-row calls.
  Quota is consumed per Sheets API call, and a batch is one ranged write.
- Long jobs belong in a time-driven trigger that processes a slice per run and
  records its progress, not in one execution that races the 6-minute ceiling.
- Catch `QuotaExceededError` and check `transient` before deciding to reschedule
  versus fail loudly.

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
- **Shape-changing calls** — `appendRow`, `deleteRow`, `insertSheet`,
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

- the adapter's own write path invalidates the cache, or
- you call `adapter.clearCache()`, or
- a new execution starts.

`findById` is not affected — it reads the row live. `find` and `findAll` are
the cached paths, and so is anything built on them (`query()`, JOINs,
aggregation).

Long-running triggers that poll for external edits must call `clearCache()`
between passes.

## Checklist Before Going to Production

- Writes go through batch APIs, not per-row loops.
- Long jobs are sliced across time-driven trigger runs.
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
