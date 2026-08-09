# @gsquery/cli

> `gsquery` — schema codegen and migration scaffolding for [gas-sheets-query](https://github.com/juhyeonni/gas-sheets-query)

Turns a `schema.gsq.yaml` file into typed tables, an optional typed client, and migration files.

**📖 Full documentation lives in the [wiki](https://juhyeonni.github.io/gas-sheets-query/) — this README is just the tour.**

## Install

```bash
pnpm add -D @gsquery/cli   # or: npm install --save-dev @gsquery/cli
```

## Quick Start

```bash
npx gsquery init                       # creates gsquery.config.json
npx gsquery generate --client          # schema.gsq.yaml -> generated types + typed client
```

```yaml
# schema.gsq.yaml
tables:
  User:
    fields:
      id:     number   @id
      name:   string
      email:  string   @unique
      active: boolean  @default(true)
```

## Commands

| Command | Description |
|---------|-------------|
| `gsquery init` | Initialize project (creates `gsquery.config.json`) |
| `gsquery generate` | Generate types/client code from schema (`--watch` to regenerate on change) |
| `gsquery generate --client` | Also generate the typed client into your project |
| `gsquery migration:create <name>` | Create a migration file |
| `gsquery migrate` / `gsquery rollback` | **Preview** migrations/rollbacks — execution happens in the GAS runtime via `MigrationRunner` |

## Documentation

- [CLI Reference](https://juhyeonni.github.io/gas-sheets-query/cli-reference) · [Schema Definition](https://juhyeonni.github.io/gas-sheets-query/schema-definition)
- [Migration System](https://juhyeonni.github.io/gas-sheets-query/migration-system) · [Typed Client](https://juhyeonni.github.io/gas-sheets-query/typed-client)

The generated code imports from [`@gsquery/core`](https://www.npmjs.com/package/@gsquery/core) (peer dependency) and, with `--client`, from [`@gsquery/client`](https://www.npmjs.com/package/@gsquery/client).

## License

[MIT](./LICENSE) © Juhyeon Lee
