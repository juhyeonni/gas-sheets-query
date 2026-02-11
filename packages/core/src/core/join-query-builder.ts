/**
 * JoinQueryBuilder - Query builder with JOIN support
 * Simulates relational joins using batch fetching to prevent N+1 queries
 */
import type { Row, DataStore, QueryOptions, Operator, SingleValueOperator, SortDirection, WhereCondition, OrderByCondition, RowWithId } from './types'
import { NoResultsError } from './errors'

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
 */
export class JoinQueryBuilder<T extends RowWithId> {
  private whereConditions: WhereCondition<T>[] = []
  private orderByConditions: OrderByCondition<T>[] = []
  private limitValue?: number
  private offsetValue?: number
  private joinConfigs: JoinConfig[] = []

  constructor(
    private readonly store: DataStore<T>,
    private readonly tableName: string,
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
   * Add a where condition
   * Supports prefixed fields for joined tables (e.g., 'posts.status')
   *
   * When operator is 'in', value must be an array.
   * For all other operators, value must be a single value.
   */
  where<K extends keyof T & string>(field: K | string, operator: 'in', value: T[K][]): this
  where<K extends keyof T & string>(field: K | string, operator: SingleValueOperator, value: T[K]): this
  where<K extends keyof T & string>(
    field: K | string,
    operator: Operator,
    value: unknown
  ): this {
    const fieldStr = field as string

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

    const cleanField = this.stripTablePrefix(fieldStr) as K

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
    return this.where(field, '=', value)
  }

  /**
   * Shorthand for where(field, '!=', value)
   */
  whereNot<K extends keyof T & string>(field: K, value: T[K]): this {
    return this.where(field, '!=', value)
  }

  /**
   * Shorthand for where(field, 'in', values)
   */
  whereIn<K extends keyof T & string>(field: K, values: T[K][]): this {
    return this.where(field, 'in', values)
  }

  /**
   * Shorthand for where(field, 'like', pattern)
   */
  whereLike<K extends keyof T & string>(field: K, pattern: string): this {
    return this.where(field, 'like', pattern as T[K])
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
        field: foreignField,
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
    const results = this.limit(1).exec()
    return results[0]
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
      orderBy: [...this.orderByConditions]
    }

    if (!hasInnerJoin) {
      // No inner join - count main table results
      return this.store.find(countOptions).length
    }

    // With inner join, execute full query without pagination for accurate count
    const savedLimit = this.limitValue
    const savedOffset = this.offsetValue
    this.limitValue = undefined
    this.offsetValue = undefined
    try {
      return this.exec().length
    } finally {
      this.limitValue = savedLimit
      this.offsetValue = savedOffset
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
  clone(): JoinQueryBuilder<T> {
    const cloned = new JoinQueryBuilder<T>(this.store, this.tableName, this.storeResolver)
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
export function createJoinQueryBuilder<T extends RowWithId>(
  store: DataStore<T>,
  tableName: string,
  storeResolver: StoreResolver
): JoinQueryBuilder<T> {
  return new JoinQueryBuilder<T>(store, tableName, storeResolver)
}
