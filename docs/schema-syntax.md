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

### @default(value)

Sets the default value.

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

Automatically updates to current time when record is modified.

```yaml
updatedAt: datetime @updatedAt
```

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
