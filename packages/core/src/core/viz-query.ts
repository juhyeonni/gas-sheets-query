/**
 * Google Visualization API Query Language converter
 * Converts QueryOptions to Google Query Language (SQL-like) syntax
 * 
 * @see https://developers.google.com/chart/interactive/docs/querylanguage
 */
import type { QueryOptions, WhereCondition, OrderByCondition, Row, Operator } from './types'

/**
 * Options for building a visualization query
 */
export interface VizQueryOptions {
  /** Column names mapping (field name → column letter, e.g., { name: 'A', email: 'B' }) */
  columnMap?: Record<string, string>
  /** Sheet name or GID (optional) */
  sheet?: string | number
  /** Range (e.g., 'A1:Z100') */
  range?: string
}

/**
 * Result of building a visualization query
 */
export interface VizQueryResult {
  /** The encoded query string (URL-safe) */
  query: string
  /** The raw unencoded query string */
  rawQuery: string
  /** Full URL for the visualization API endpoint */
  url: string
}

/**
 * Parsed response from Google Visualization API
 */
export interface VizApiResponse<T extends Row = Row> {
  /** Status: 'ok', 'warning', or 'error' */
  status: 'ok' | 'warning' | 'error'
  /** Parsed data rows */
  rows: T[]
  /** Column metadata */
  columns: VizColumn[]
  /** Error/warning messages */
  messages?: string[]
  /** Number of rows in the response */
  rowCount: number
}

/**
 * Column metadata from viz API response
 */
export interface VizColumn {
  id: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'timeofday'
}

/**
 * Convert a value to Google Query Language literal
 */
function toQueryLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'string') {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''")
    return `'${escaped}'`
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value instanceof Date) {
    // Format as date literal
    const y = value.getFullYear()
    const m = value.getMonth() + 1
    const d = value.getDate()
    return `date '${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}'`
  }
  // Fallback: stringify
  return `'${String(value)}'`
}

/**
 * Convert operator to Google Query Language operator
 */
function toQueryOperator(operator: Operator): string {
  switch (operator) {
    case '=': return '='
    case '!=': return '!='
    case '>': return '>'
    case '>=': return '>='
    case '<': return '<'
    case '<=': return '<='
    case 'like': return 'like'
    case 'in': return 'in'
    default:
      throw new Error(`Unsupported operator: ${operator}`)
  }
}

/**
 * Convert a field name to column reference
 */
function toColumnRef(field: string, columnMap?: Record<string, string>): string {
  if (columnMap && field in columnMap) {
    return columnMap[field]
  }
  // If no mapping, assume field name is the column label
  return `\`${field}\``
}

/**
 * Build WHERE clause from conditions
 */
function buildWhereClause(
  conditions: WhereCondition[],
  columnMap?: Record<string, string>
): string {
  if (conditions.length === 0) return ''
  
  const parts = conditions.map(cond => {
    const col = toColumnRef(cond.field, columnMap)
    const op = toQueryOperator(cond.operator)
    
    if (cond.operator === 'in') {
      // IN clause: value should be an array
      const values = Array.isArray(cond.value) ? cond.value : [cond.value]
      const literals = values.map(v => toQueryLiteral(v)).join(', ')
      return `${col} ${op} (${literals})`
    }
    
    if (cond.operator === 'like') {
      // Convert SQL LIKE pattern to Google's contains/starts with/ends with
      // Google Query Language uses different syntax:
      // - contains: field contains 'value'
      // - starts with: field starts with 'value'
      // - ends with: field ends with 'value'
      // - matches: field matches 'regex'
      const pattern = String(cond.value)
      
      if (pattern.startsWith('%') && pattern.endsWith('%')) {
        // %value% → contains
        const inner = pattern.slice(1, -1)
        return `${col} contains ${toQueryLiteral(inner)}`
      } else if (pattern.endsWith('%')) {
        // value% → starts with
        const inner = pattern.slice(0, -1)
        return `${col} starts with ${toQueryLiteral(inner)}`
      } else if (pattern.startsWith('%')) {
        // %value → ends with
        const inner = pattern.slice(1)
        return `${col} ends with ${toQueryLiteral(inner)}`
      } else {
        // Exact match with wildcards: use matches (regex)
        // Convert SQL LIKE to regex: % → .*, _ → .
        const regex = pattern.replace(/%/g, '.*').replace(/_/g, '.')
        return `${col} matches '${regex}'`
      }
    }
    
    return `${col} ${op} ${toQueryLiteral(cond.value)}`
  })
  
  return `where ${parts.join(' and ')}`
}

/**
 * Build ORDER BY clause
 */
function buildOrderByClause(
  orderBy: OrderByCondition[],
  columnMap?: Record<string, string>
): string {
  if (orderBy.length === 0) return ''
  
  const parts = orderBy.map(o => {
    const col = toColumnRef(o.field, columnMap)
    return `${col} ${o.direction}`
  })
  
  return `order by ${parts.join(', ')}`
}

/**
 * Build LIMIT/OFFSET clause
 */
function buildLimitOffsetClause(limit?: number, offset?: number): string {
  const parts: string[] = []
  
  if (limit !== undefined && limit > 0) {
    parts.push(`limit ${limit}`)
  }
  
  if (offset !== undefined && offset > 0) {
    parts.push(`offset ${offset}`)
  }
  
  return parts.join(' ')
}

/**
 * Build a complete Google Query Language query string
 */
export function buildVizQuery<T extends Row>(
  options: QueryOptions<T>,
  vizOptions: VizQueryOptions = {}
): string {
  const parts: string[] = []
  
  // SELECT: always select all columns (*)
  parts.push('select *')
  
  // WHERE
  const whereClause = buildWhereClause(
    options.where as WhereCondition[],
    vizOptions.columnMap
  )
  if (whereClause) parts.push(whereClause)
  
  // ORDER BY
  const orderByClause = buildOrderByClause(
    options.orderBy as OrderByCondition[],
    vizOptions.columnMap
  )
  if (orderByClause) parts.push(orderByClause)
  
  // LIMIT/OFFSET
  const limitOffset = buildLimitOffsetClause(options.limitValue, options.offsetValue)
  if (limitOffset) parts.push(limitOffset)
  
  return parts.join(' ')
}

/**
 * Build the full visualization API URL
 */
export function buildVizUrl(
  spreadsheetId: string,
  query: string,
  vizOptions: VizQueryOptions = {}
): string {
  const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`
  const params = new URLSearchParams()
  
  params.set('tq', query)
  
  // Add sheet reference if provided
  if (vizOptions.sheet !== undefined) {
    if (typeof vizOptions.sheet === 'number') {
      params.set('gid', String(vizOptions.sheet))
    } else {
      params.set('sheet', vizOptions.sheet)
    }
  }
  
  // Add range if provided
  if (vizOptions.range) {
    params.set('range', vizOptions.range)
  }
  
  return `${baseUrl}?${params.toString()}`
}

/**
 * Build a complete viz query result with URL
 */
export function buildVizQueryResult<T extends Row>(
  spreadsheetId: string,
  options: QueryOptions<T>,
  vizOptions: VizQueryOptions = {}
): VizQueryResult {
  const rawQuery = buildVizQuery(options, vizOptions)
  const query = encodeURIComponent(rawQuery)
  const url = buildVizUrl(spreadsheetId, rawQuery, vizOptions)
  
  return { query, rawQuery, url }
}

/**
 * Parse Google Visualization API JSON response
 * The response format is: google.visualization.Query.setResponse({...})
 */
export function parseVizResponse<T extends Row>(
  responseText: string,
  columnNames?: string[]
): VizApiResponse<T> {
  // Extract JSON from the JSONP-like response
  // Format: google.visualization.Query.setResponse(JSON_DATA);
  const match = responseText.match(/google\.visualization\.Query\.setResponse\((.+)\);?$/s)
  
  if (!match) {
    // Try parsing as raw JSON
    try {
      const data = JSON.parse(responseText)
      return parseVizData(data, columnNames)
    } catch {
      throw new Error('Invalid visualization API response format')
    }
  }
  
  const jsonStr = match[1]
  const data = JSON.parse(jsonStr)
  return parseVizData(data, columnNames)
}

/**
 * Parse the visualization data object
 */
function parseVizData<T extends Row>(
  data: {
    status?: string
    table?: {
      cols?: Array<{ id: string; label: string; type: string }>
      rows?: Array<{ c: Array<{ v: unknown; f?: string } | null> }>
    }
    errors?: Array<{ message: string }>
    warnings?: Array<{ message: string }>
  },
  columnNames?: string[]
): VizApiResponse<T> {
  const status = (data.status || 'ok') as 'ok' | 'warning' | 'error'
  const messages: string[] = []
  
  // Collect errors and warnings
  if (data.errors) {
    messages.push(...data.errors.map(e => `Error: ${e.message}`))
  }
  if (data.warnings) {
    messages.push(...data.warnings.map(w => `Warning: ${w.message}`))
  }
  
  // Parse columns
  const columns: VizColumn[] = (data.table?.cols || []).map(col => ({
    id: col.id,
    label: col.label,
    type: col.type as VizColumn['type']
  }))
  
  // Determine column names for row mapping
  const colNames = columnNames || columns.map((col, i) => col.label || col.id || `col${i}`)
  
  // Parse rows
  const rows: T[] = (data.table?.rows || []).map(row => {
    const obj: Record<string, unknown> = {}
    const cells = row.c || []
    
    for (let i = 0; i < colNames.length && i < cells.length; i++) {
      const cell = cells[i]
      if (cell === null) {
        obj[colNames[i]] = null
      } else {
        obj[colNames[i]] = cell.v
      }
    }
    
    return obj as T
  })
  
  return {
    status,
    rows,
    columns,
    messages: messages.length > 0 ? messages : undefined,
    rowCount: rows.length
  }
}

/**
 * Create visualization API fetcher for GAS environment
 * Returns a function that fetches and parses viz API responses
 */
export function createVizFetcher(
  spreadsheetId: string,
  vizOptions: VizQueryOptions = {}
): <T extends Row>(options: QueryOptions<T>, columnNames?: string[]) => VizApiResponse<T> {
  return <T extends Row>(options: QueryOptions<T>, columnNames?: string[]): VizApiResponse<T> => {
    const result = buildVizQueryResult(spreadsheetId, options, vizOptions)
    
    // This is meant to be used in GAS environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (globalThis as any).UrlFetchApp.fetch(result.url, {
      headers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'Authorization': 'Bearer ' + (globalThis as any).ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    })
    
    const responseText = response.getContentText()
    return parseVizResponse<T>(responseText, columnNames)
  }
}
