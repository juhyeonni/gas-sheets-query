# @gsquery/client

> Browser runtime for [gas-sheets-query](https://github.com/juhyeonni/gas-sheets-query) — typed client + local-first sync

Gives the browser the same `SheetsDB` API you use on GAS, backed by IndexedDB instead of a spreadsheet: local reads, queued offline mutations, and sync to a GAS web app.

**📖 Full documentation lives in the [wiki](https://juhyeonni.github.io/gas-sheets-query/) — this README is just the tour.**

## Install

```bash
pnpm add @gsquery/core @gsquery/client   # or: npm install @gsquery/core @gsquery/client
```

## Quick Start

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

Prefer a thin typed wrapper over a remote GAS backend instead of a local copy? Use `createClientFactory` — see [Typed Client](https://juhyeonni.github.io/gas-sheets-query/typed-client).

## ESM only

This package is published as ESM only (`"type": "module"`, `exports` with an `import` condition). It targets browsers and bundlers, where every consumer resolves the `import` condition; unlike `@gsquery/core` — which additionally ships CJS and a GAS IIFE bundle — there is no `require()` consumer for an IndexedDB-backed runtime. Import it with `import`, not `require()`.

## Documentation

- [Local-First Client](https://juhyeonni.github.io/gas-sheets-query/local-first-client) · [Typed Client](https://juhyeonni.github.io/gas-sheets-query/typed-client)
- [Installation](https://juhyeonni.github.io/gas-sheets-query/installation) · [API Reference](https://juhyeonni.github.io/gas-sheets-query/api-reference)

The local-first client is single-tab: two tabs sharing a namespace can clobber each other's queued mutations. See the wiki for the full trade-off list.

## License

[MIT](./LICENSE) © Juhyeon Lee
