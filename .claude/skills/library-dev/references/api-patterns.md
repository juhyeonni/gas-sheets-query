# API Design Patterns

## Builder Pattern

```typescript
class QueryBuilder<T> {
  private conditions: Condition[] = []
  private ordering: Order | null = null
  private limitValue: number | null = null

  where(column: keyof T, op: Operator, value: unknown): this {
    this.conditions.push({ column, op, value })
    return this  // Enable chaining
  }

  orderBy(column: keyof T, dir: 'asc' | 'desc' = 'asc'): this {
    this.ordering = { column, dir }
    return this
  }

  limit(n: number): this {
    this.limitValue = n
    return this
  }

  exec(): T[] {
    // Execute query with accumulated state
  }
}
```

## Factory Pattern

```typescript
// Hide implementation, expose simple factory
export function createSheetsDB(config: Config): SheetsDB {
  const adapter = config.mock 
    ? new MockAdapter() 
    : new GasAdapter(config.spreadsheetId)
  
  return new SheetsDBImpl(adapter, config.tables)
}
```

## Adapter Pattern

```typescript
// Abstract interface
interface SheetAdapter {
  getAll(table: string): unknown[][]
  getRange(table: string, row: number, col: number, rows: number, cols: number): unknown[][]
  appendRow(table: string, data: unknown[]): void
  updateRow(table: string, row: number, data: unknown[]): void
  deleteRow(table: string, row: number): void
}

// GAS implementation
class GasAdapter implements SheetAdapter {
  getAll(table: string) {
    return getSheet(table).getDataRange().getValues()
  }
  // ...
}

// Mock for testing
class MockAdapter implements SheetAdapter {
  private data: Map<string, unknown[][]> = new Map()
  
  getAll(table: string) {
    return this.data.get(table) || []
  }
  // ...
}
```

## Options with Defaults

```typescript
interface Options {
  cacheEnabled?: boolean
  cacheTtlMs?: number
  retryOnError?: boolean
  maxRetries?: number
}

const DEFAULT_OPTIONS: Required<Options> = {
  cacheEnabled: false,
  cacheTtlMs: 60000,
  retryOnError: true,
  maxRetries: 3,
}

function createDB(config: Config) {
  const options = { ...DEFAULT_OPTIONS, ...config.options }
  // ...
}
```
