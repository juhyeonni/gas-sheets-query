# Basic CRUD Example

Basic CRUD (Create, Read, Update, Delete) operations example using gas-sheets-query.

## Run

```bash
npx tsx examples/basic-crud/index.ts
```

## Key Concepts

### 1. DB Initialization

```typescript
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role', 'active', 'createdAt'] as const,
      types: { id: 0, name: '', email: '', role: 'USER', active: true, createdAt: new Date() }
    }
  },
  stores: {
    users: new MockAdapter<User>()
  }
})
```

### 2. CREATE

```typescript
// Single create
const user = users.create({ name: 'John', email: 'john@example.com', ... })

// Batch create
const newUsers = users.batchInsert([...])
```

### 3. READ

```typescript
// Find by ID
const user = users.findById(1)

// Find all
const all = users.findAll()

// Query with conditions
const active = users.query().where('active', '=', true).exec()
```

### 4. UPDATE

```typescript
// Single update
users.update(1, { name: 'New Name' })

// Batch update
users.batchUpdate([{ id: 1, data: { ... } }, ...])
```

### 5. DELETE

```typescript
// Single delete
users.delete(1)
```

## Example Output

```
=== CREATE ===
Created user: { id: 1, name: 'John Doe', ... }
Batch created: 3 users

=== READ ===
Found by ID: John Doe
Total users: 4
Active users: 3
First admin: Bob Wilson

=== UPDATE ===
Updated name: John Smith
Updated role: ADMIN
Batch updated 2 users

=== DELETE ===
Deleted 1 user: 4 -> 3
Deleted 2 inactive users

=== FINAL STATE ===
Remaining users: 1
  - Robert Wilson (ADMIN, active: true)
```
