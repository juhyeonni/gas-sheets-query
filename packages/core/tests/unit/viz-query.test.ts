import { describe, it, expect } from 'vitest'
import {
  buildVizQuery,
  buildVizUrl,
  buildVizQueryResult,
  parseVizResponse
} from '../../src/core/viz-query'
import type { QueryOptions } from '../../src/core/types'

describe('viz-query', () => {
  describe('buildVizQuery', () => {
    it('should build empty query with just select *', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select *')
    })
    
    it('should build query with equality condition', () => {
      const options: QueryOptions = {
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `status` = 'active'")
    })
    
    it('should build query with number comparison', () => {
      const options: QueryOptions = {
        where: [{ field: 'age', operator: '>', value: 18 }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * where `age` > 18')
    })
    
    it('should build query with boolean', () => {
      const options: QueryOptions = {
        where: [{ field: 'active', operator: '=', value: true }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * where `active` = true')
    })
    
    it('should build query with multiple where conditions (AND)', () => {
      const options: QueryOptions = {
        where: [
          { field: 'status', operator: '=', value: 'active' },
          { field: 'age', operator: '>=', value: 18 }
        ],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `status` = 'active' and `age` >= 18")
    })
    
    it('should build query with IN clause', () => {
      const options: QueryOptions = {
        where: [{ field: 'role', operator: 'in', value: ['admin', 'editor'] }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `role` in ('admin', 'editor')")
    })
    
    it('should build query with LIKE pattern - contains', () => {
      const options: QueryOptions = {
        where: [{ field: 'name', operator: 'like', value: '%john%' }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `name` contains 'john'")
    })
    
    it('should build query with LIKE pattern - starts with', () => {
      const options: QueryOptions = {
        where: [{ field: 'name', operator: 'like', value: 'john%' }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `name` starts with 'john'")
    })
    
    it('should build query with LIKE pattern - ends with', () => {
      const options: QueryOptions = {
        where: [{ field: 'email', operator: 'like', value: '%@gmail.com' }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `email` ends with '@gmail.com'")
    })
    
    it('should build query with ORDER BY', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: [{ field: 'name', direction: 'asc' }]
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * order by `name` asc')
    })
    
    it('should build query with multiple ORDER BY', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: [
          { field: 'age', direction: 'desc' },
          { field: 'name', direction: 'asc' }
        ]
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * order by `age` desc, `name` asc')
    })
    
    it('should build query with LIMIT', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: [],
        limitValue: 10
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * limit 10')
    })
    
    it('should build query with OFFSET', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: [],
        offsetValue: 20
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * offset 20')
    })
    
    it('should build query with LIMIT and OFFSET', () => {
      const options: QueryOptions = {
        where: [],
        orderBy: [],
        limitValue: 10,
        offsetValue: 20
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * limit 10 offset 20')
    })
    
    it('should build complex query with all clauses', () => {
      const options: QueryOptions = {
        where: [
          { field: 'status', operator: '=', value: 'active' },
          { field: 'age', operator: '>', value: 18 }
        ],
        orderBy: [
          { field: 'score', direction: 'desc' }
        ],
        limitValue: 50,
        offsetValue: 100
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe(
        "select * where `status` = 'active' and `age` > 18 order by `score` desc limit 50 offset 100"
      )
    })
    
    it('should escape single quotes in string values', () => {
      const options: QueryOptions = {
        where: [{ field: 'name', operator: '=', value: "O'Brien" }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `name` = 'O''Brien'")
    })
    
    it('should use column mapping when provided', () => {
      const options: QueryOptions = {
        where: [{ field: 'name', operator: '=', value: 'Alice' }],
        orderBy: [{ field: 'age', direction: 'asc' }]
      }
      
      const query = buildVizQuery(options, {
        columnMap: { name: 'A', age: 'B' }
      })
      
      expect(query).toBe("select * where A = 'Alice' order by B asc")
    })
    
    it('should handle null values', () => {
      const options: QueryOptions = {
        where: [{ field: 'deletedAt', operator: '=', value: null }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe('select * where `deletedAt` = null')
    })
    
    it('should handle Date values', () => {
      const date = new Date(2024, 0, 15) // 2024-01-15
      const options: QueryOptions = {
        where: [{ field: 'createdAt', operator: '>=', value: date }],
        orderBy: []
      }
      
      const query = buildVizQuery(options)
      expect(query).toBe("select * where `createdAt` >= date '2024-01-15'")
    })
  })
  
  describe('buildVizUrl', () => {
    it('should build basic URL', () => {
      const url = buildVizUrl('abc123', 'select *')
      expect(url).toBe('https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tq=select+*')
    })
    
    it('should include sheet GID', () => {
      const url = buildVizUrl('abc123', 'select *', { sheet: 12345 })
      expect(url).toContain('gid=12345')
    })
    
    it('should include sheet name', () => {
      const url = buildVizUrl('abc123', 'select *', { sheet: 'Users' })
      expect(url).toContain('sheet=Users')
    })
    
    it('should include range', () => {
      const url = buildVizUrl('abc123', 'select *', { range: 'A1:D100' })
      expect(url).toContain('range=A1%3AD100') // colon encoded
    })
  })
  
  describe('buildVizQueryResult', () => {
    it('should return complete result object', () => {
      const options: QueryOptions = {
        where: [{ field: 'status', operator: '=', value: 'active' }],
        orderBy: []
      }
      
      const result = buildVizQueryResult('spreadsheet123', options)
      
      expect(result.rawQuery).toBe("select * where `status` = 'active'")
      expect(result.query).toBe(encodeURIComponent(result.rawQuery))
      expect(result.url).toContain('spreadsheet123')
      expect(result.url).toContain('gviz/tq')
    })
  })
  
  describe('parseVizResponse', () => {
    it('should parse standard JSONP response', () => {
      const responseText = `google.visualization.Query.setResponse({
        "status": "ok",
        "table": {
          "cols": [
            {"id": "A", "label": "name", "type": "string"},
            {"id": "B", "label": "age", "type": "number"}
          ],
          "rows": [
            {"c": [{"v": "Alice"}, {"v": 30}]},
            {"c": [{"v": "Bob"}, {"v": 25}]}
          ]
        }
      });`
      
      const result = parseVizResponse(responseText)
      
      expect(result.status).toBe('ok')
      expect(result.rowCount).toBe(2)
      expect(result.columns.length).toBe(2)
      expect(result.rows).toEqual([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ])
    })
    
    it('should parse response with custom column names', () => {
      const responseText = `google.visualization.Query.setResponse({
        "status": "ok",
        "table": {
          "cols": [
            {"id": "A", "label": "", "type": "string"},
            {"id": "B", "label": "", "type": "number"}
          ],
          "rows": [
            {"c": [{"v": "Alice"}, {"v": 30}]}
          ]
        }
      });`
      
      const result = parseVizResponse(responseText, ['userName', 'userAge'])
      
      expect(result.rows).toEqual([
        { userName: 'Alice', userAge: 30 }
      ])
    })
    
    it('should handle null cells', () => {
      const responseText = `google.visualization.Query.setResponse({
        "status": "ok",
        "table": {
          "cols": [
            {"id": "A", "label": "name", "type": "string"},
            {"id": "B", "label": "email", "type": "string"}
          ],
          "rows": [
            {"c": [{"v": "Alice"}, null]}
          ]
        }
      });`
      
      const result = parseVizResponse(responseText)
      
      expect(result.rows).toEqual([
        { name: 'Alice', email: null }
      ])
    })
    
    it('should handle error status', () => {
      const responseText = `google.visualization.Query.setResponse({
        "status": "error",
        "errors": [
          {"message": "Invalid query"}
        ]
      });`
      
      const result = parseVizResponse(responseText)
      
      expect(result.status).toBe('error')
      expect(result.messages).toContain('Error: Invalid query')
      expect(result.rowCount).toBe(0)
    })
    
    it('should handle warning status', () => {
      const responseText = `google.visualization.Query.setResponse({
        "status": "warning",
        "warnings": [
          {"message": "Query truncated"}
        ],
        "table": {
          "cols": [],
          "rows": []
        }
      });`
      
      const result = parseVizResponse(responseText)
      
      expect(result.status).toBe('warning')
      expect(result.messages).toContain('Warning: Query truncated')
    })
    
    it('should parse raw JSON response', () => {
      const responseText = JSON.stringify({
        status: 'ok',
        table: {
          cols: [{ id: 'A', label: 'name', type: 'string' }],
          rows: [{ c: [{ v: 'Alice' }] }]
        }
      })
      
      const result = parseVizResponse(responseText)
      
      expect(result.status).toBe('ok')
      expect(result.rows).toEqual([{ name: 'Alice' }])
    })
    
    it('should throw on invalid response format', () => {
      expect(() => parseVizResponse('invalid response')).toThrow(
        'Invalid visualization API response format'
      )
    })
  })
})
