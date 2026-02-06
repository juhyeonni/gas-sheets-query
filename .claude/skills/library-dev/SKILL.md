# Library Development Skill

Best practices for developing and publishing TypeScript libraries.

## API Design Principles

### 1. Simple Entry Point
```typescript
// ✅ Good - one clear entry
import { createSheetsDB } from 'gas-sheets-query'
const db = createSheetsDB({ ... })

// ❌ Bad - confusing imports
import { SheetsDB, QueryBuilder, Repository, ... } from 'gas-sheets-query'
```

### 2. Fluent API (Method Chaining)
```typescript
// ✅ Readable, discoverable
db.from('users')
  .where('status', '=', 'active')
  .orderBy('name')
  .limit(10)
  .exec()
```

### 3. Sensible Defaults
```typescript
// Works with minimal config
const db = createSheetsDB({ tables: { users: {} } })

// But allows customization
const db = createSheetsDB({
  spreadsheetId: 'xxx',
  tables: { users: { columns: [...], indexes: [...] } },
  options: { cacheEnabled: true }
})
```

## Type Safety

### Generic Inference
```typescript
// Schema defines types
const db = createSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: {} as { id: string; name: string; email: string }
    }
  }
})

// Auto-complete works
db.from('users').where('name', '=', 'John')  // ✅ 'name' is typed
db.from('users').where('foo', '=', 'x')      // ❌ Error: 'foo' not in users
```

## Testing Strategy

### Unit Tests
- Test each function in isolation
- Mock external dependencies (Sheets API)

### Integration Tests  
- Test with real Sheets (separate test spreadsheet)
- Run in CI with service account

### Example Test Structure
```
tests/
├── unit/
│   ├── query-builder.test.ts
│   └── repository.test.ts
├── integration/
│   └── gas-adapter.test.ts
└── fixtures/
    └── test-data.ts
```

## Versioning & Release

### Semantic Versioning
- MAJOR: Breaking API changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

### Release Checklist
1. Update CHANGELOG.md
2. Run full test suite
3. Bump version: `pnpm version [major|minor|patch]`
4. Build: `pnpm build`
5. Publish: `npm publish`
6. Create GitHub release with tag

## Documentation

### README Structure
1. One-liner description
2. Installation
3. Quick start (copy-paste example)
4. API reference
5. Advanced usage
6. Contributing

### JSDoc for Public APIs
```typescript
/**
 * Create a query builder for the specified table.
 * 
 * @param table - Table name defined in schema
 * @returns QueryBuilder instance for chaining
 * 
 * @example
 * ```ts
 * db.from('users').where('active', '=', true).exec()
 * ```
 */
from<T extends keyof Tables>(table: T): QueryBuilder<Tables[T]>
```

## Error Handling

### Descriptive Errors
```typescript
// ✅ Good
throw new Error(`Table "${table}" not found. Available: ${Object.keys(tables).join(', ')}`)

// ❌ Bad
throw new Error('Invalid table')
```

### Error Types
```typescript
export class SheetsQueryError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'SheetsQueryError'
  }
}

export class TableNotFoundError extends SheetsQueryError {
  constructor(table: string) {
    super(`Table "${table}" not found`, 'TABLE_NOT_FOUND')
  }
}
```

## References

- [references/api-patterns.md](references/api-patterns.md) - Common API patterns
- [references/npm-publish.md](references/npm-publish.md) - npm publishing guide
