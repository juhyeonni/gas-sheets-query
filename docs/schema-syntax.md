# GSQ Schema Syntax

GSQ schema defines database structure in YAML format.

## Basic Structure

```yaml
# schema.gsq.yaml

enums:
  # enum definitions

tables:
  # table definitions
```

## Types

### Basic Types

| Type | TypeScript | Description |
|------|------------|-------------|
| `string` | `string` | String |
| `number` | `number` | Number (integer, decimal) |
| `boolean` | `boolean` | Boolean (true/false) |
| `datetime` | `Date` | Date/Time |

### Optional Types

Add `?` after the type to make it optional.

```yaml
name: string?    # string | undefined
age: number?     # number | undefined
```

### Enum Types

Use names defined in the `enums` section.

```yaml
enums:
  Role:
    - USER
    - ADMIN
    - MODERATOR

tables:
  User:
    fields:
      role: Role    # 'USER' | 'ADMIN' | 'MODERATOR'
```

## Table Definition

Tables consist of `fields`, `indexes`, and `unique` sections.

```yaml
tables:
  TableName:
    fields:
      fieldName: type @attribute1 @attribute2(arg)
    indexes:
      - [field1]
      - [field1, field2]
    unique:
      - [field1, field2]
```

### Example

```yaml
tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string?
      age: number @default(0)
      active: boolean @default(true)
      createdAt: datetime @default(now)
```

## Field Attributes

### @id

Designates the field as primary key. Only one per table.

```yaml
id: number @id
```

> **Contract (1.0):** the `@id` field **must be named `id`**. Schema validation rejects any other name (e.g. `userId: number @id`) with a clear error. Custom primary-key column names are planned for a future release. This keeps the generated types, both adapters, and the runtime consistent.
>
> The `idColumn` option on `SheetsAdapterOptions` / `TableSchema` predates this contract and is **deprecated**. Only `SheetsAdapter` honors it; `MockAdapter` and `LocalAdapter` have no such option, `defineSheetsDB` stores it without reading it, and `InferRowFromSchema` always types rows as `& { id }` — so a custom name produces rows whose declared type does not match their runtime shape. Leave it unset.

### @default(value)

Declares the field's default value.

> ⚠️ **Not applied at runtime.** `@default` is parsed and carried through codegen as documentation of intent, but no adapter fills the value in: generated `create()` types still require the field, and your application code must supply it (the one exception is the primary key in auto `idMode`, which the adapter allocates regardless of this attribute). Runtime application is planned for a later release.

| Value | Description |
|-------|-------------|
| `autoincrement` | Auto-increment (number only) |
| `now` | Current time (datetime only) |
| `true` / `false` | Boolean value |
| `0`, `100` | Numeric value |
| `"text"` | String value |
| `EnumValue` | Enum value |

```yaml
id: number @default(autoincrement)
count: number @default(0)
active: boolean @default(true)
role: Role @default(USER)
createdAt: datetime @default(now)
```

### @unique

Specifies that the field value must be unique.

```yaml
email: string @unique
```

### @updatedAt

Declares that the field holds the record's last-modified time.

> ⚠️ **Not applied at runtime.** Nothing auto-fills this on update today — set it from your application code (`update(id, { ..., updatedAt: new Date() })`). Runtime application is planned for a later release.

```yaml
updatedAt: datetime @updatedAt
```

### @relation(Table)

Marks a field as a foreign key referencing another table's `id`. The generator
emits a type alias per referenced table and uses it as the field's type.

```yaml
tables:
  User:
    fields:
      id: number @id @default(autoincrement)

  Task:
    fields:
      id: number @id @default(autoincrement)
      assigneeId: number? @relation(User)
      watcherIds: number[]? @relation(User)
```

```typescript
export type UserId = User['id']

export interface Task {
  id: number
  assigneeId?: UserId
  watcherIds?: UserId[]
}
```

**The field's type must match the referenced table's `id` type.** `User.id` is
`number` above, so the foreign keys are `number` / `number[]`; declaring
`assigneeId: string @relation(User)` is rejected by schema validation, because
the emitted `UserId` would resolve to `number` and contradict the declaration.

> **Scope:** `@relation` is a **typing and documentation** aid. It does not add
> runtime behaviour — no automatic JOIN, no foreign-key integrity check on
> write, no cascade delete. Use `joinQuery()` to join explicitly.
>
> `UserId` is a plain type alias, not a branded type, so it is structurally
> identical to `number` — nothing prevents assigning a raw `number` or a
> `ProjectId` to a `UserId`. This is a deliberate 1.0 choice: branded types
> would enforce the distinction but require a cast at every assignment site.

## Block Attributes

Attributes applied at the table level.

### indexes

Creates indexes.

```yaml
tables:
  Post:
    fields:
      title: string
      authorId: number
    indexes:
      - [title]
      - [authorId, title]
```

### unique

Creates composite unique constraints.

```yaml
tables:
  Post:
    fields:
      authorId: number
      slug: string
    unique:
      - [authorId, slug]
```

## Full Example

```yaml
# schema.gsq.yaml

enums:
  Role:
    - USER
    - ADMIN

  Status:
    - DRAFT
    - PUBLISHED
    - ARCHIVED

tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string?
      role: Role @default(USER)
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt

  Post:
    fields:
      id: number @id @default(autoincrement)
      title: string
      content: string?
      status: Status @default(DRAFT)
      authorId: number
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt
    indexes:
      - [authorId]
    unique:
      - [authorId, title]

  Comment:
    fields:
      id: number @id @default(autoincrement)
      content: string
      postId: number
      authorId: number
      createdAt: datetime @default(now)
    indexes:
      - [postId]
      - [authorId]
```

## Generated Output

TypeScript generated from the above schema:

```typescript
// generated/types.ts

export type Role = 'USER' | 'ADMIN'
export type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface User {
  id: number
  email: string
  name?: string
  role: Role
  createdAt: Date
  updatedAt: Date
}

export interface Post {
  id: number
  title: string
  content?: string
  status: Status
  authorId: number
  createdAt: Date
  updatedAt: Date
}

export interface Comment {
  id: number
  content: string
  postId: number
  authorId: number
  createdAt: Date
}
```
