/**
 * Query Builder - fluent API for building queries
 */
import type { Row, DataStore, QueryOptions, Operator, SortDirection, WhereCondition, OrderByCondition } from './types'
import { NoResultsError } from './errors'

/**
 * QueryBuilder provides a fluent interface for building and executing queries
 * 
 * @example
 * ```ts
 * const users = query
 *   .where('active', '=', true)
 *   .where('age', '>', 18)
 *   .orderBy('name', 'asc')
 *   .limit(10)
 *   .exec()
 * ```
 */
export class QueryBuilder<T extends Row & { id: string | number }> {
  private whereConditions: WhereCondition<T>[] = []
  private orderByConditions: OrderByCondition<T>[] = []
  private limitValue?: number
  private offsetValue?: number

  constructor(private readonly store: DataStore<T>) {}

  /**
   * Add a where condition
   * Multiple where calls are combined with AND
   */
  where<K extends keyof T & string>(
    field: K,
    operator: Operator,
    value: T[K] | T[K][]
  ): this {
    this.whereConditions.push({
      field,
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
   * Execute the query and return results
   */
  exec(): T[] {
    return this.store.find(this.build())
  }

  /**
   * Execute and return the first result or undefined
   */
  first(): T | undefined {
    const results = this.limit(1).exec()
    return results[0]
  }

  /**
   * Execute and return the first result or throw
   * @throws NoResultsError if no results found
   */
  firstOrFail(): T {
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
    // Remove limit/offset for counting
    const original = { limit: this.limitValue, offset: this.offsetValue }
    this.limitValue = undefined
    this.offsetValue = undefined
    
    const count = this.store.find(this.build()).length
    
    // Restore original values
    this.limitValue = original.limit
    this.offsetValue = original.offset
    
    return count
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
  clone(): QueryBuilder<T> {
    const cloned = new QueryBuilder<T>(this.store)
    cloned.whereConditions = [...this.whereConditions]
    cloned.orderByConditions = [...this.orderByConditions]
    cloned.limitValue = this.limitValue
    cloned.offsetValue = this.offsetValue
    return cloned
  }
}

/**
 * Create a new QueryBuilder for the given store
 */
export function createQueryBuilder<T extends Row & { id: string | number }>(
  store: DataStore<T>
): QueryBuilder<T> {
  return new QueryBuilder<T>(store)
}
