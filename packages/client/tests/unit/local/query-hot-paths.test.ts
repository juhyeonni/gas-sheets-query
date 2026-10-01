/**
 * #233 - LocalAdapter shares the core query pipeline.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'

let conversions = 0
class CountingDate extends Date {
  override getTime(): number {
    conversions++
    return super.getTime()
  }
  override valueOf(): number {
    conversions++
    return super.valueOf()
  }
}

interface Item {
  id: string
  when: Date
  [key: string]: unknown
}

const T0 = Date.parse('2026-01-15T10:00:00.000Z')

beforeEach(() => {
  conversions = 0
})

describe('LocalAdapter query hot paths (#233)', () => {
  it('in over Dates converts keys once per find; orderBy converts each row once; input order unchanged', () => {
    const N = 1000
    const K = 100
    const data: Item[] = Array.from({ length: N }, (_, i) => ({
      id: `r${i}`,
      when: new CountingDate(T0 + ((i * 7919) % N))
    }))
    const adapter = new LocalAdapter<Item>({
      tableName: 'Item',
      idMode: 'client',
      disableIDB: true,
      initialData: data,
      mutationStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
    })
    const keys = Array.from({ length: K }, (_, i) => new CountingDate(T0 + i * 10))
    conversions = 0
    const found = adapter.find({ where: [{ field: 'when', operator: 'in', value: keys } as never], orderBy: [] })
    expect(found).toHaveLength(K)
    expect(conversions).toBeLessThanOrEqual(N + K)

    const before = adapter.findAll().map(r => r.id)
    conversions = 0
    const sorted = adapter.find({ where: [], orderBy: [{ field: 'when', direction: 'asc' }] })
    expect(conversions).toBeLessThanOrEqual(2 * N)
    expect(sorted).toHaveLength(N)
    expect(adapter.findAll().map(r => r.id)).toEqual(before)
  })
})
