/**
 * Query Builder - fluent API for building queries
 */
import type { Row, DataStore, QueryOptions, Operator, SingleValueOperator, SortDirection, WhereCondition, OrderByCondition } from './types'
import { NoResultsError } from './errors'

/**
 * Aggregation specification
 * - 'count' - count of rows in group
 * - 'sum:field' - sum of field values
 * - 'avg:field' - average of field values
 * - 'min:field' - minimum field value
 * - 'max:field' - maximum field value
 */
export type AggSpec = 'count' | `sum:${string}` | `avg:${string}` | `min:${string}` | `max:${string}`

/**
 * Aggregation result object
 */
export type AggResult<T extends Record<string, AggSpec>> = {
  [K in keyof T]: number
}

/**
 * Grouped aggregation result with group key
 */
export type GroupedAggResult<G extends string, T extends Record<string, AggSpec>> = 
  { [K in G]: unknown } & AggResult<T>

/**
 * Having condition for filtering groups
 */
export interface HavingCondition {
  aggName: string
  operator: Operator
  value: number
}

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
  private groupByFields: (keyof T & string)[] = []
  private havingConditions: HavingCondition[] = []

  constructor(private readonly store: DataStore<T>) {}

  /**
   * Add a where condition
   * Multiple where calls are combined with AND
   *
   * When operator is 'in', value must be an array.
   * For all other operators, value must be a single value.
   */
  where<K extends keyof T & string>(field: K, operator: 'in', value: T[K][]): this
  where<K extends keyof T & string>(field: K, operator: SingleValueOperator, value: T[K]): this
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
    return this.store.find(this.buildWithoutPagination()).length
  }

  /**
   * Calculate sum of a numeric field
   * Returns 0 for empty datasets (sum of nothing is 0)
   */
  sum<K extends keyof T & string>(field: K): number {
    const rows = this.getRowsForAggregation()
    return rows.reduce((acc, row) => {
      const value = row[field]
      return acc + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  /**
   * Calculate average of a numeric field
   * Returns null if no rows match
   */
  avg<K extends keyof T & string>(field: K): number | null {
    const rows = this.getRowsForAggregation()
    if (rows.length === 0) return null
    const values = rows
      .map(row => row[field])
      .filter(v => typeof v === 'number') as number[]
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /**
   * Find minimum value of a field
   * Returns null if no rows or no numeric values exist
   */
  min<K extends keyof T & string>(field: K): number | null {
    const rows = this.getRowsForAggregation()
    if (rows.length === 0) return null
    const values = rows
      .map(row => row[field])
      .filter(v => typeof v === 'number') as number[]
    return values.length > 0 ? Math.min(...values) : null
  }

  /**
   * Find maximum value of a field
   * Returns null if no rows or no numeric values exist
   */
  max<K extends keyof T & string>(field: K): number | null {
    const rows = this.getRowsForAggregation()
    if (rows.length === 0) return null
    const values = rows
      .map(row => row[field])
      .filter(v => typeof v === 'number') as number[]
    return values.length > 0 ? Math.max(...values) : null
  }

  /**
   * Group by one or more fields
   */
  groupBy<K extends keyof T & string>(...fields: K[]): this {
    this.groupByFields = fields
    return this
  }

  /**
   * Filter groups by aggregation condition
   * Only valid after groupBy()
   */
  having(aggName: string, operator: Operator, value: number): this {
    this.havingConditions.push({ aggName, operator, value })
    return this
  }

  /**
   * Execute aggregation and return results
   * If groupBy() was called, returns grouped results
   * Otherwise returns a single aggregation result
   */
  agg<A extends Record<string, AggSpec>>(specs: A): GroupedAggResult<(typeof this.groupByFields)[number], A>[] {
    const rows = this.getRowsForAggregation()
    
    if (this.groupByFields.length === 0) {
      // No grouping - return single result
      const result = this.computeAggregations(rows, specs)
      return [result as GroupedAggResult<(typeof this.groupByFields)[number], A>]
    }
    
    // Group rows by fields
    const groups = new Map<string, T[]>()
    for (const row of rows) {
      const key = this.groupByFields.map(f => String(row[f])).join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }
    
    // Compute aggregations for each group
    const results: GroupedAggResult<(typeof this.groupByFields)[number], A>[] = []
    
    for (const [, groupRows] of groups) {
      const aggs = this.computeAggregations(groupRows, specs)
      
      // Apply having conditions
      if (!this.passesHavingConditions(aggs)) {
        continue
      }
      
      // Add group key fields
      const result: Record<string, unknown> = { ...aggs }
      for (const field of this.groupByFields) {
        result[field] = groupRows[0][field]
      }
      
      results.push(result as GroupedAggResult<(typeof this.groupByFields)[number], A>)
    }
    
    return results
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
    cloned.groupByFields = [...this.groupByFields]
    cloned.havingConditions = [...this.havingConditions]
    return cloned
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Build query options without limit/offset (for count and aggregations)
   */
  private buildWithoutPagination(): QueryOptions<T> {
    return {
      where: [...this.whereConditions],
      orderBy: [...this.orderByConditions]
    }
  }

  /**
   * Get rows for aggregation (ignores limit/offset)
   */
  private getRowsForAggregation(): T[] {
    return this.store.find(this.buildWithoutPagination())
  }

  /**
   * Compute aggregation values for a set of rows
   */
  private computeAggregations<A extends Record<string, AggSpec>>(
    rows: T[],
    specs: A
  ): AggResult<A> {
    const result: Record<string, number> = {}
    
    for (const [name, spec] of Object.entries(specs)) {
      if (spec === 'count') {
        result[name] = rows.length
      } else {
        const [fn, field] = spec.split(':') as [string, keyof T & string]
        const values = rows
          .map(row => row[field])
          .filter(v => typeof v === 'number') as number[]
        
        switch (fn) {
          case 'sum':
            result[name] = values.reduce((a, b) => a + b, 0)
            break
          case 'avg':
            result[name] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
            break
          case 'min':
            result[name] = values.length > 0 ? Math.min(...values) : 0
            break
          case 'max':
            result[name] = values.length > 0 ? Math.max(...values) : 0
            break
        }
      }
    }
    
    return result as AggResult<A>
  }

  /**
   * Check if aggregation results pass all having conditions
   */
  private passesHavingConditions(aggs: Record<string, number>): boolean {
    for (const cond of this.havingConditions) {
      const value = aggs[cond.aggName]
      if (value === undefined) continue
      
      if (!this.compareValues(value, cond.operator, cond.value)) {
        return false
      }
    }
    return true
  }

  /**
   * Compare two values with an operator
   */
  private compareValues(left: number, operator: Operator, right: number): boolean {
    switch (operator) {
      case '=': return left === right
      case '!=': return left !== right
      case '>': return left > right
      case '>=': return left >= right
      case '<': return left < right
      case '<=': return left <= right
      default: return true
    }
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
