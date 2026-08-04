---
slug: /
title: gas-sheets-query
sidebar_label: Home
---

# gas-sheets-query

**Use Google Sheets as a typed database in Google Apps Script.**

`gas-sheets-query` provides a fluent, type-safe API for CRUD operations, queries, JOINs, aggregations, and schema migrations -- all backed by Google Sheets.

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age'] as const,
      types: { id: 0, name: '', email: '', age: 0 }
    }
  },
  mock: true // swap to SheetsAdapter for production
})

// CRUD
const user = db.from('users').create({ name: 'Alice', email: 'alice@example.com', age: 30 })

// Query
const adults = db.from('users').query()
  .where('age', '>=', 18)
  .orderBy('name')
  .limit(10)
  .exec()
```

---

## Table of Contents

### Getting Started
- [Installation](./installation.md)
- [Quick Start](./quick-start.md)
- [Schema Definition](./schema-definition.md)

### Core Concepts
- [Architecture Overview](./architecture-overview.md)
- [Adapters](./adapters.md)
- [ID Modes](./id-modes.md)

### Usage Guide
- [CRUD Operations](./crud-operations.md)
- [Query Builder](./query-builder.md)
- [JOIN Queries](./join-queries.md)
- [Aggregation](./aggregation.md)
- [Batch Operations](./batch-operations.md)

### Advanced
- [Migration System](./migration-system.md)
- [CLI Reference](./cli-reference.md)
- [Typed Client](./typed-client.md)
- [Indexing and Performance](./indexing-and-performance.md)
- [AI Assistant Skills](./ai-assistant-skills.md)

### Reference
- [Error Handling](./error-handling.md)
- [API Reference](./api-reference.md)

---

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@gsquery/core` | [![npm](https://img.shields.io/npm/v/@gsquery/core)](https://www.npmjs.com/package/@gsquery/core) | Core library (Repository, QueryBuilder, Adapters) |
| `@gsquery/cli` | [![npm](https://img.shields.io/npm/v/@gsquery/cli)](https://www.npmjs.com/package/@gsquery/cli) | CLI tool for schema generation and migrations |
| `@gsquery/client` | [![npm](https://img.shields.io/npm/v/@gsquery/client)](https://www.npmjs.com/package/@gsquery/client) | Typed client with environment detection |
| `@gsquery/skills` | [![npm](https://img.shields.io/npm/v/@gsquery/skills)](https://www.npmjs.com/package/@gsquery/skills) | AI coding assistant context files (skills/cheatsheet) |

## Quick Links

- [GitHub Repository](https://github.com/juhyeonni/gas-sheets-query)
- [npm: @gsquery/core](https://www.npmjs.com/package/@gsquery/core)
- [Report an Issue](https://github.com/juhyeonni/gas-sheets-query/issues)
