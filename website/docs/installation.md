---
description: Install @gsquery/core, @gsquery/cli, and @gsquery/client via pnpm, npm, or yarn, plus the prerequisites for GAS deployment.
---

# Installation

## Prerequisites

- **Node.js** >= 18
- **pnpm**, **npm**, or **yarn**
- (For GAS deployment) [clasp](https://github.com/google/clasp) CLI

## Install Packages

### Core only (most users)

```bash
# pnpm
pnpm add @gsquery/core

# npm
npm install @gsquery/core

# yarn
yarn add @gsquery/core
```

### With CLI (schema generation & migrations)

```bash
pnpm add @gsquery/core
pnpm add -D @gsquery/cli
```

### With Typed Client (auto-generated typed DB client)

```bash
pnpm add @gsquery/core @gsquery/client
pnpm add -D @gsquery/cli
```

## Which Packages Do I Need?

| Package | When to install |
|---------|----------------|
| `@gsquery/core` | Always -- contains Repository, QueryBuilder, Adapters |
| `@gsquery/cli` | If you use YAML schemas, type generation, or migrations |
| `@gsquery/client` | If you want a pre-typed client factory with environment detection |

## Verify Installation

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    test: {
      columns: ['id', 'value'] as const,
      types: { id: 0, value: '' }
    }
  },
  mock: true
})

console.log(db.from('test').findAll()) // []
```

---

## Deploying to Apps Script

Apps Script has no module system, so the library must reach your GAS project as plain bundled JavaScript. Two ways:

### Option A — use the prebuilt bundle (no bundler needed)

Every release ships a self-contained IIFE bundle that defines a global `SheetsQuery`:

```bash
cp node_modules/@gsquery/core/dist/gas/bundle.js your-gas-project/gsquery.js
npx clasp push
```

Everything exported from `@gsquery/core` is available under the global:

```js
// Code.gs — plain JS, no imports
const db = SheetsQuery.defineSheetsDB({
  tables: { users: { columns: ['id', 'name'], types: { id: 0, name: '' } } },
  stores: {
    users: new SheetsQuery.SheetsAdapter({ sheetName: 'users', columns: ['id', 'name'] })
  }
})
```

### Option B — bundle your own code together with the library (TypeScript projects)

Write your GAS code in TypeScript importing `@gsquery/core` normally, then bundle to one file with esbuild and push with clasp:

```bash
npx esbuild src/main.ts --bundle --format=iife --target=es2020 \
  --platform=neutral --outfile=dist/Code.js
npx clasp push
```

Expose your entry points (`doGet`, trigger handlers, menu functions) on `globalThis` so the GAS runtime can see them — an IIFE hides everything else:

```ts
import { defineSheetsDB, SheetsAdapter } from '@gsquery/core'

function onOpen() { /* ... */ }
;(globalThis as Record<string, unknown>).onOpen = onOpen
```

This repo's own E2E harness uses exactly this pattern (`e2e/gas/build.mjs`) if you want a working reference.

---

## See Also

- [Quick Start](./quick-start.md) -- 60-second tutorial
- [Architecture Overview](./architecture-overview.md) -- How the packages fit together
- [CLI Reference](./cli-reference.md) -- CLI commands for schema and migration workflows
