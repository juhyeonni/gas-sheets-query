---
description: Test SheetsAdapter code in Node without a Google account using the GAS fakes from @gsquery/core/testing — installGasFakes, FakeSpreadsheet, and CSV/JSON loaders.
---

# Testing Without GAS

Two ways to test code that uses gsquery, from cheapest to most faithful:

| Approach | What runs | Use when |
|---|---|---|
| `MockAdapter` / `mock: true` | Pure in-memory store, no GAS involved | Testing *your* logic on top of the query API |
| GAS fakes (`@gsquery/core/testing`) | The **real `SheetsAdapter`** against a simulated spreadsheet | Testing behavior that lives in the adapter: column mapping, id allocation, escaping, migrations |

## GAS fakes

`installGasFakes` installs offline, deterministic replacements for the GAS globals (`SpreadsheetApp`, `LockService`) so `SheetsAdapter` runs unmodified in Node or vitest:

```ts
import { SheetsAdapter } from '@gsquery/core'
import { installGasFakes, fromArrays } from '@gsquery/core/testing'

// Seed a spreadsheet from plain arrays (first row = header)
const spreadsheet = fromArrays(
  {
    users: [
      ['id', 'name'],
      [1, 'Alice']
    ]
  },
  'TestSpreadsheet'
)

const handle = installGasFakes({
  spreadsheets: { 'my-id': spreadsheet },
  activeId: 'my-id'
})

try {
  const adapter = new SheetsAdapter<{ id: number; name: string }>({
    spreadsheetId: 'my-id',
    sheetName: 'users',
    columns: ['id', 'name']
  })

  adapter.insert({ name: 'Bob' }) // gets id 2
  console.log(adapter.findAll())  // [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]
} finally {
  handle.restore() // remove the fake globals
}
```

:::warning Seed with `fromArrays`, not the constructor
`new FakeSpreadsheet(name)` takes a **name string** — passing seed data there silently creates an empty spreadsheet whose name is your data object. Use `fromArrays` / `fromCsv` / `fromJson` to seed.
:::

## API summary

- **`installGasFakes({ spreadsheets, activeId? })`** → `{ restore() }` — installs `SpreadsheetApp`/`LockService` fakes; always `restore()` in test teardown.
- **`fromArrays(sheets, name?)`** — build a `FakeSpreadsheet` from `{ sheetName: unknown[][] }` grids.
- **`fromCsv(name, csv)`** / **`fromJson(json)`** — build a sheet/spreadsheet from CSV text or a JSON snapshot.
- **`toGrid(sheet)`** / **`toCsv(sheet)`** / **`toJson(spreadsheet)`** — snapshot the end state for assertions or golden files.
- **`FakeSpreadsheet`** / **`FakeSheet`** / **`FakeRange`** — the underlying simulation, GAS-parity semantics for the allowlisted surface; methods the fakes cannot simulate faithfully (e.g. `Range.sort`) simply do not exist, so misuse fails loudly instead of passing silently.

## DataStore conformance suite

`runDataStoreConformance` registers the `DataStore` contract as test cases: CRUD (plus `batchInsert`, `batchUpdate`, `batchDelete` and `count` when the store has them), id immutability through `update`/`batchUpdate`, client-id uniqueness, empty-cell semantics, indexed-vs-unindexed `find` parity, and auto ids that never go backwards. `MockAdapter`, `SheetsAdapter` and `LocalAdapter` all run it, so code tested against one behaves the same on the others. Run it against your own adapter to check it meets the same contract:

```ts
import { describe, it } from 'vitest'
import { runDataStoreConformance } from '@gsquery/core/testing'
import type { ConformanceRow, DataStoreFactory } from '@gsquery/core/testing'
import { MyAdapter } from '../src/my-adapter'

const create: DataStoreFactory = ({ idMode, seed, columns, indexes }) => {
  const store = new MyAdapter<ConformanceRow>({ idMode, initialData: seed, columns, indexes })
  return { store, cleanup: () => store.close() } // cleanup is optional
}

runDataStoreConformance({ name: 'MyAdapter', create, describe, it })
```

- The suite takes your runner's `describe` and `it` and fails by throwing plain errors, so it works with vitest, jest or mocha and does not pull a test runner into your bundle.
- `create` is called several times per case, and every call must return an independent store holding `seed` exactly as given (ids included, in both id modes). `cleanup` runs after each case.
- A store without index support may ignore `indexes`. Pass `idModes: ['client']` to run only one id mode.
- Each clause compares a store with itself, never with another adapter: a field written as `undefined`, `null` or `''` may read back as any of the three.

## What the fakes cannot catch

The fakes write synchronously and their lock never blocks, so they cannot reproduce real `SpreadsheetApp` write buffering, real lock contention, or real `USER_ENTERED` parsing. This repo covers that gap with a [real-Apps-Script E2E harness](https://github.com/juhyeonni/gas-sheets-query/tree/main/e2e/gas); for most consumer test suites the fakes plus `MockAdapter` are enough.

## See Also

- [Adapters](./adapters.md) -- MockAdapter and SheetsAdapter in depth
- [Quick Start](./quick-start.md) -- the mock-first workflow
