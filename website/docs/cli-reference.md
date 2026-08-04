# CLI Reference

The `@gsquery/cli` package provides commands for schema management, type generation, and migrations.

## Installation

```bash
pnpm add -D @gsquery/cli
```

## Commands

### `gsquery init`

Create a gsquery configuration file.

```bash
npx gsquery init [options]
```

| Option | Description |
|--------|-------------|
| `-s, --spreadsheet-id <id>` | Google Spreadsheet ID |
| `-f, --force` | Overwrite existing config file |

### `gsquery generate`

Parse a `.gsq.yaml` schema file and generate TypeScript types (and optionally a typed client).

```bash
npx gsquery generate [options]
```

| Option | Description |
|--------|-------------|
| `-s, --schema <path>` | Schema file path (default: `schema.gsq.yaml`) |
| `-o, --output <path>` | Output directory (default: `generated`) |
| `-w, --watch` | Watch the schema file and regenerate on changes |
| `-c, --client` | Also generate a typed client in `@gsquery/client/generated` |

**Example:**

```bash
npx gsquery generate -s schema.gsq.yaml -o src/generated --client
```

### `gsquery migrate`

Preview pending migrations. Actual execution happens in the GAS runtime.

```bash
npx gsquery migrate [options]
```

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Migrations directory (default: from config or `migrations`) |
| `-t, --to <version>` | Migrate up to a specific version |

### `gsquery rollback`

Preview a migration rollback. Actual execution happens in the GAS runtime.

```bash
npx gsquery rollback [options]
```

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Migrations directory (default: from config or `migrations`) |
| `-a, --all` | Roll back all migrations |
| `-s, --steps <number>` | Number of migrations to roll back |

### `gsquery migration:create`

Create a new migration file.

```bash
npx gsquery migration:create <name> [options]
```

| Option | Description |
|--------|-------------|
| `<name>` | Migration name (e.g., `add_role_to_users`) |
| `-d, --dir <path>` | Migrations directory (default: from config or `migrations`) |

Creates a timestamped migration file with `up` and `down` stubs.

## Schema File Format

See [Schema Definition](./schema-definition.md) for the full `.gsq.yaml` format reference.

### Example Schema

```yaml
# schema.gsq.yaml
enums:
  Role:
    - admin
    - editor
    - viewer

tables:
  User:
    fields:
      id:     number  @id
      name:   string
      email:  string  @unique
      role:   Role    @default(viewer)
      active: boolean @default(true)

  Post:
    fields:
      id:        number   @id
      title:     string
      body:      string
      authorId:  number
      published: boolean  @default(false)
    indexes:
      - [authorId]
```

### Generated Types (Example Output)

```ts
// generated/types.ts
export type Role = 'admin' | 'editor' | 'viewer'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  active: boolean
}

export interface Post {
  id: number
  title: string
  body: string
  authorId: number
  published: boolean
}
```

## Workflow

```bash
# 1. Initialize project
npx gsquery init

# 2. Edit schema.gsq.yaml

# 3. Generate types
npx gsquery generate -s schema.gsq.yaml -o src/generated

# 4. Use in your code
# import { User, Post } from './generated/types'

# 5. Create a migration when schema changes
npx gsquery migration:create add-user-avatar

# 6. Run migrations
npx gsquery migrate
```

---

## See Also

- [Schema Definition](./schema-definition.md) -- YAML schema format
- [Typed Client](./typed-client.md) -- Using the generated client
- [Migration System](./migration-system.md) -- Migration API in code
