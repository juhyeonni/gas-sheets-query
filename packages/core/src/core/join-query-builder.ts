/**
 * JoinQueryBuilder - Query builder with JOIN support
 * Simulates relational joins using batch fetching to prevent N+1 queries
 */
import type { DataStore, QueryOptions, Operator, SingleValueOperator, SortDirection, WhereCondition, OrderByCondition, RowWithId } from './types.js'
import { NoResultsError } from './errors.js'

/**
 * Join configuration
 */
export interface JoinConfig {
  /** Target table name */
  table: string
  /** Field in the source table (foreign key) */
  localField: string
  /** Field in the target table (usually 'id') */
  foreignField: string
  /** Property name to nest the joined data under (defaults to table name) */
  as?: string
  /** Type of join (currently only 'left' is supported) */
  type: 'left' | 'inner'
}

/**
 * Store resolver function type
 * Used to get the DataStore for a table name
 */
export type StoreResolver = <T extends RowWithId>(tableName: string) => DataStore<T>

/**
 * Field accepted by JoinQueryBuilder.where(): a main-table key, or the same key
 * prefixed with the main table's name (e.g. 'status' or 'posts.status').
 * With `TName` left as `string`, any prefix compiles and where() checks it at runtime.
 */
export type JoinWhereField<T, TName extends string = string> =
  | (keyof T & string)
  | `${TName}.${keyof T & string}`

/**
 * The main-table key a JoinWhereField refers to, with any table prefix removed
 * (e.g. 'posts.status' -> 'status'). The prefix itself is checked by JoinWhereField.
 */
export type JoinWhereKey<T, F extends string> =
  F extends keyof T & string
    ? F
    : F extends `${string}.${infer K}`
      ? Extract<K, keyof T & string>
      : never

/**
 * JoinQueryBuilder provides a fluent interface for building queries with JOIN support
 * 
 * @example
 * ```ts
 * const postsWithAuthors = db.from('posts')
 *   .join('users', 'authorId', 'id')
 *   .where('status', '=', 'published')
 *   .exec()
 * 
 * // Result: { ...post, users: { id, name, email, ... } }
 * ```
 *
 * `TName` is the main table's name, which `db.from(name)` passes as a literal
 * type so where() accepts only `<mainTable>.<key>` prefixes. It defaults to `string`.
 */
export class JoinQueryBuilder<T extends RowWithId, TName extends string = string> {
  private whereConditions: WhereCondition<T>[] = []
  private orderByConditions: OrderByCondition<T>[] = []
  private limitValue?: number
  private offsetValue?: number
  private joinConfigs: JoinConfig[] = []

  constructor(
    private readonly store: DataStore<T>,
    private readonly tableName: TName,
    private readonly storeResolver: StoreResolver
  ) {}

  /**
   * Add a join to another table
   * 
   * @param table - Target table name to join
   * @param localField - Field in the source table (foreign key)
   * @param foreignField - Field in the target table (default: 'id')
   * @param options - Additional join options
   * 
   * @example
   * ```ts
   * // posts.authorId = users.id
   * db.from('posts').join('users', 'authorId', 'id')
   * 
   * // Custom alias: { ...post, author: { ...user } }
   * db.from('posts').join('users', 'authorId', 'id', { as: 'author' })
   * ```
   */
  join(
    table: string,
    localField: keyof T & string,
    foreignField: string = 'id',
    options?: { as?: string; type?: 'left' | 'inner' }
  ): this {
    this.joinConfigs.push({
      table,
      localField,
      foreignField,
      as: options?.as,
      type: options?.type ?? 'left'
    })
    return this
  }

  /**
   * Add a left join (same as join with type: 'left')
   */
  leftJoin(
    table: string,
    localField: keyof T & string,
    foreignField: string = 'id',
    options?: { as?: string }
  ): this {
    return this.join(table, localField, foreignField, { ...options, type: 'left' })
  }

  /**
   * Add an inner join
   * Rows without matching foreign rows are excluded
   */
  innerJoin(
    table: string,
    localField: keyof T & string,
    foreignField: string = 'id',
    options?: { as?: string }
  ): this {
    return this.join(table, localField, foreignField, { ...options, type: 'inner' })
  }

  /**
   * Add a where condition on a main-table field
   * The field is a main-table key, optionally prefixed with the main table's
   * name (e.g., 'status' or 'posts.status'). The value is typed by that key.
   *
   * When operator is 'in', value must be an array.
   * For all other operators, value must be a single value.
   *
   * @throws Error if the prefix names another table: filter joined data after exec()
   */
  where<F extends JoinWhereField<T, TName>>(
    field: F,
    operator: 'in',
    value: T[JoinWhereKey<T, F>][]
  ): this
  where<F extends JoinWhereField<T, TName>>(
    field: F,
    operator: SingleValueOperator,
    value: T[JoinWhereKey<T, F>]
  ): this
  where(
    field: JoinWhereField<T, TName>,
    operator: Operator,
    value: unknown
  ): this {
    return this.addWhere(field, operator, value)
  }

  /**
   * Record a where condition, checking and stripping a table prefix
   */
  private addWhere(fieldStr: string, operator: Operator, value: unknown): this {
    // Check for table-prefixed fields (e.g., 'users.name')
    if (fieldStr.includes('.')) {
      const [prefix] = fieldStr.split('.', 2)
      if (prefix !== this.tableName) {
        throw new Error(
          `Cannot filter on joined table field "${fieldStr}". ` +
          `Only fields from the main table "${this.tableName}" are supported in where(). ` +
          `Filter joined data after exec() instead.`
        )
      }
    }

    const cleanField = this.stripTablePrefix(fieldStr) as keyof T & string

    this.whereConditions.push({
      field: cleanField,
      operator,
      value
    } as WhereCondition<T>)
    return this
  }

  /**
   * Shorthand for where(field, '=', value)
   */
  whereEq<K extends keyof T & string>(field: K, value: T[K]): this {
    return this.addWhere(field, '=', value)
  }

  /**
   * Shorthand for where(field, '!=', value)
   */
  whereNot<K extends keyof T & string>(field: K, value: T[K]): this {
    return this.addWhere(field, '!=', value)
  }

  /**
   * Shorthand for where(field, 'in', values)
   */
  whereIn<K extends keyof T & string>(field: K, values: T[K][]): this {
    return this.addWhere(field, 'in', values)
  }

  /**
   * Shorthand for where(field, 'like', pattern)
   */
  whereLike<K extends keyof T & string>(field: K, pattern: string): this {
    return this.addWhere(field, 'like', pattern)
  }

  /**
   * Add an order by condition
   */
  orderBy<K extends keyof T & string>(field: K, direction: SortDirection = 'asc'): this {
    this.orderByConditions.push({ field, direction })
    return this
  }

  /**
   * Set the maximum number of results
   */
  limit(count: number): this {
    this.limitValue = count
    return this
  }

  /**
   * Set the number of results to skip
   */
  offset(count: number): this {
    this.offsetValue = count
    return this
  }

  /**
   * Shorthand for offset/limit for pagination
   */
  page(pageNumber: number, pageSize: number): this {
    this.offsetValue = (pageNumber - 1) * pageSize
    this.limitValue = pageSize
    return this
  }

  /**
   * Build the query options without executing
   */
  build(): QueryOptions<T> {
    return {
      where: [...this.whereConditions],
      orderBy: [...this.orderByConditions],
      limitValue: this.limitValue,
      offsetValue: this.offsetValue
    }
  }

  /**
   * Execute the query and return results with joined data
   */
  exec(): (T & Record<string, unknown>)[] {
    // 1. Execute the main query
    const mainResults = this.store.find(this.build())

    // 2. If no joins or no results, return as-is
    if (this.joinConfigs.length === 0 || mainResults.length === 0) {
      return mainResults
    }

    // 3. Process each join
    let results: (T & Record<string, unknown>)[] = [...mainResults]

    for (const joinConfig of this.joinConfigs) {
      results = this.executeJoin(results, joinConfig)
    }

    return results
  }

  /**
   * Execute a single join operation
   * Uses batch fetching to prevent N+1 queries
   */
  private executeJoin(
    rows: (T & Record<string, unknown>)[],
    config: JoinConfig
  ): (T & Record<string, unknown>)[] {
    const { table, localField, foreignField, as, type } = config
    const propertyName = as ?? table

    // 1. Extract unique foreign key values (N+1 prevention)
    const foreignKeys = new Set<unknown>()
    for (const row of rows) {
      const key = row[localField as keyof T]
      if (key !== undefined && key !== null) {
        foreignKeys.add(key)
      }
    }

    // If no foreign keys, return rows with null joined data
    if (foreignKeys.size === 0) {
      return rows.map(row => ({ ...row, [propertyName]: null }))
    }

    // 2. Batch fetch related rows
    const foreignStore = this.storeResolver(table)
    const foreignRows = foreignStore.find({
      where: [{
        field: foreignField as keyof RowWithId & string,
        operator: 'in',
        value: Array.from(foreignKeys)
      }],
      orderBy: []
    })

    // 3. Create lookup map
    const lookupMap = new Map<unknown, RowWithId>()
    for (const foreignRow of foreignRows) {
      const key = (foreignRow as Record<string, unknown>)[foreignField]
      lookupMap.set(key, foreignRow)
    }

    // 4. Merge results
    const mergedResults: (T & Record<string, unknown>)[] = []
    for (const row of rows) {
      const key = row[localField as keyof T]
      const foreignData = lookupMap.get(key) ?? null

      // For inner join, skip rows without matching foreign data
      if (type === 'inner' && foreignData === null) {
        continue
      }

      mergedResults.push({
        ...row,
        [propertyName]: foreignData
      })
    }

    return mergedResults
  }

  /**
   * Strip table prefix from field name (e.g., 'posts.status' -> 'status')
   */
  private stripTablePrefix(field: string): string {
    const dotIndex = field.indexOf('.')
    if (dotIndex !== -1) {
      return field.substring(dotIndex + 1)
    }
    return field
  }

  /**
   * Execute and return the first result or undefined
   */
  first(): (T & Record<string, unknown>) | undefined {
    // Apply limit 1 without permanently mutating this builder, so it stays reusable.
    const savedLimit = this.limitValue
    this.limitValue = 1
    try {
      return this.exec()[0]
    } finally {
      this.limitValue = savedLimit
    }
  }

  /**
   * Execute and return the first result or throw
   * @throws NoResultsError if no results found
   */
  firstOrFail(): T & Record<string, unknown> {
    const result = this.first()
    if (!result) {
      throw new NoResultsError()
    }
    return result
  }

  /**
   * Execute and return count of results
   */
  count(): number {
    // For counting, we need to account for inner joins
    const hasInnerJoin = this.joinConfigs.some(c => c.type === 'inner')

    const countOptions: QueryOptions<T> = {
      where: [...this.whereConditions],
      orderBy: []
    }

    if (!hasInnerJoin) {
      // No inner join - count main table results
      return this.store.find(countOptions).length
    }

    // With inner join, execute full query without pagination for accurate count
    const savedLimit = this.limitValue
    const savedOffset = this.offsetValue
    const savedOrderBy = this.orderByConditions
    this.limitValue = undefined
    this.offsetValue = undefined
    this.orderByConditions = []
    try {
      return this.exec().length
    } finally {
      this.limitValue = savedLimit
      this.offsetValue = savedOffset
      this.orderByConditions = savedOrderBy
    }
  }

  /**
   * Check if any results exist
   */
  exists(): boolean {
    return this.first() !== undefined
  }

  /**
   * Clone this query builder for modification
   */
  clone(): JoinQueryBuilder<T, TName> {
    const cloned = new JoinQueryBuilder<T, TName>(this.store, this.tableName, this.storeResolver)
    cloned.whereConditions = [...this.whereConditions]
    cloned.orderByConditions = [...this.orderByConditions]
    cloned.limitValue = this.limitValue
    cloned.offsetValue = this.offsetValue
    cloned.joinConfigs = [...this.joinConfigs]
    return cloned
  }
}

/**
 * Create a new JoinQueryBuilder for the given store
 */
export function createJoinQueryBuilder<T extends RowWithId, TName extends string = string>(
  store: DataStore<T>,
  tableName: TName,
  storeResolver: StoreResolver
): JoinQueryBuilder<T, TName> {
  return new JoinQueryBuilder<T, TName>(store, tableName, storeResolver)
}
