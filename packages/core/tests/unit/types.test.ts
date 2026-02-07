import { describe, it, expect } from 'vitest'
import { VERSION } from '../../src'
import type { Row, Operator, DataStore, QueryOptions } from '../../src'

describe('Core Types', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.2.0')
  })

  it('Row type allows any string keys', () => {
    const row: Row = { id: 1, name: 'test', active: true }
    expect(row.id).toBe(1)
    expect(row.name).toBe('test')
  })

  it('Operator type includes all comparison operators', () => {
    const operators: Operator[] = ['=', '!=', '>', '>=', '<', '<=', 'like', 'in']
    expect(operators.length).toBe(8)
  })

  it('QueryOptions has correct structure', () => {
    const options: QueryOptions = {
      where: [{ field: 'name', operator: '=', value: 'test' }],
      orderBy: [{ field: 'id', direction: 'asc' }],
      limitValue: 10,
      offsetValue: 0
    }
    expect(options.where.length).toBe(1)
    expect(options.orderBy.length).toBe(1)
  })
})
