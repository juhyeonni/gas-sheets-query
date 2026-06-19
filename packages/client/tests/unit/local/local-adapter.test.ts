/**
 * LocalAdapter tests - DataStore<T> interface + MutationQueue integration
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Counter {
  id: string
  value: number
  updatedAt: string
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

describe('LocalAdapter', () => {
  let adapter: LocalAdapter<Counter>

  beforeEach(() => {
    adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })
  })

  // ── DataStore<T> interface ──────────────────────────────────────────

  describe('DataStore interface', () => {
    it('findAll returns empty array initially', () => {
      expect(adapter.findAll()).toEqual([])
    })

    it('insert and findById', () => {
      const row = adapter.insert({ id: 'c1', value: 0, updatedAt: '2024-01-01' })
      expect(row).toEqual({ id: 'c1', value: 0, updatedAt: '2024-01-01' })

      const found = adapter.findById('c1')
      expect(found).toEqual(row)
    })

    it('insert requires id in client mode', () => {
      expect(() => adapter.insert({ value: 1, updatedAt: '' } as any)).toThrow(
        /ID is required/
      )
    })

    it('findAll returns all rows', () => {
      adapter.insert({ id: 'a', value: 1, updatedAt: '' })
      adapter.insert({ id: 'b', value: 2, updatedAt: '' })
      adapter.insert({ id: 'c', value: 3, updatedAt: '' })

      const all = adapter.findAll()
      expect(all).toHaveLength(3)
    })

    it('update modifies existing row', () => {
      adapter.insert({ id: 'c1', value: 0, updatedAt: '2024-01-01' })
      const updated = adapter.update('c1', { value: 5 })
      expect(updated?.value).toBe(5)
      expect(updated?.updatedAt).toBe('2024-01-01') // unchanged field preserved
    })

    it('update returns undefined for missing row', () => {
      expect(adapter.update('missing', { value: 1 })).toBeUndefined()
    })

    it('delete removes row', () => {
      adapter.insert({ id: 'c1', value: 0, updatedAt: '' })
      expect(adapter.delete('c1')).toBe(true)
      expect(adapter.findById('c1')).toBeUndefined()
      expect(adapter.findAll()).toHaveLength(0)
    })

    it('delete returns false for missing row', () => {
      expect(adapter.delete('missing')).toBe(false)
    })

    it('find with where conditions', () => {
      adapter.insert({ id: 'a', value: 10, updatedAt: '' })
      adapter.insert({ id: 'b', value: 20, updatedAt: '' })
      adapter.insert({ id: 'c', value: 30, updatedAt: '' })

      const result = adapter.find({
        where: [{ field: 'value', operator: '>=', value: 20 }],
        orderBy: [],
      })
      expect(result).toHaveLength(2)
    })

    it('find with orderBy', () => {
      adapter.insert({ id: 'a', value: 30, updatedAt: '' })
      adapter.insert({ id: 'b', value: 10, updatedAt: '' })
      adapter.insert({ id: 'c', value: 20, updatedAt: '' })

      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'value', direction: 'asc' }],
      })
      expect(result.map(r => r.value)).toEqual([10, 20, 30])
    })

    it('find with limit and offset', () => {
      adapter.insert({ id: 'a', value: 1, updatedAt: '' })
      adapter.insert({ id: 'b', value: 2, updatedAt: '' })
      adapter.insert({ id: 'c', value: 3, updatedAt: '' })

      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'value', direction: 'asc' }],
        offsetValue: 1,
        limitValue: 1,
      })
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe(2)
    })
  })

  // ── Batch operations ───────────────────────────────────────────────

  describe('batch operations', () => {
    it('batchInsert adds multiple rows', () => {
      const rows = adapter.batchInsert([
        { id: 'a', value: 1, updatedAt: '' },
        { id: 'b', value: 2, updatedAt: '' },
        { id: 'c', value: 3, updatedAt: '' },
      ])
      expect(rows).toHaveLength(3)
      expect(adapter.findAll()).toHaveLength(3)
    })

    it('batchUpdate updates multiple rows', () => {
      adapter.batchInsert([
        { id: 'a', value: 1, updatedAt: '' },
        { id: 'b', value: 2, updatedAt: '' },
      ])

      const updated = adapter.batchUpdate([
        { id: 'a', data: { value: 10 } },
        { id: 'b', data: { value: 20 } },
      ])
      expect(updated).toHaveLength(2)
      expect(adapter.findById('a')?.value).toBe(10)
      expect(adapter.findById('b')?.value).toBe(20)
    })

    it('batchUpdate skips missing rows', () => {
      adapter.insert({ id: 'a', value: 1, updatedAt: '' })
      const updated = adapter.batchUpdate([
        { id: 'a', data: { value: 10 } },
        { id: 'missing', data: { value: 99 } },
      ])
      expect(updated).toHaveLength(1)
    })
  })

  // ── MutationQueue integration ──────────────────────────────────────

  describe('MutationQueue integration', () => {
    it('insert records mutation', () => {
      adapter.insert({ id: 'c1', value: 0, updatedAt: '' })
      expect(adapter.queue.length).toBe(1)

      const merged = adapter.queue.getMerged()
      expect(merged[0].type).toBe('insert')
      expect(merged[0].id).toBe('c1')
    })

    it('update records mutation', () => {
      adapter.insert({ id: 'c1', value: 0, updatedAt: '' })
      adapter.update('c1', { value: 5 })
      expect(adapter.queue.length).toBe(2)

      const merged = adapter.queue.getMerged()
      // insert + update → insert (merged)
      expect(merged).toHaveLength(1)
      expect(merged[0].type).toBe('insert')
    })

    it('delete records mutation', () => {
      adapter.insert({ id: 'c1', value: 0, updatedAt: '' })
      adapter.delete('c1')

      // insert + delete → cancelled out
      const merged = adapter.queue.getMerged()
      expect(merged).toHaveLength(0)
    })

    it('batchInsert records mutations for each row', () => {
      adapter.batchInsert([
        { id: 'a', value: 1, updatedAt: '' },
        { id: 'b', value: 2, updatedAt: '' },
      ])
      expect(adapter.queue.length).toBe(2)
    })

    it('batchUpdate records mutations for each row', () => {
      adapter.batchInsert([
        { id: 'a', value: 1, updatedAt: '' },
        { id: 'b', value: 2, updatedAt: '' },
      ])
      adapter.batchUpdate([
        { id: 'a', data: { value: 10 } },
        { id: 'b', data: { value: 20 } },
      ])
      expect(adapter.queue.length).toBe(4) // 2 inserts + 2 updates
    })
  })

  // ── replaceAll (SyncEngine support) ────────────────────────────────

  describe('replaceAll', () => {
    it('replaces all data without recording mutations', () => {
      adapter.insert({ id: 'a', value: 1, updatedAt: '' })
      adapter.queue.clear() // Clear the insert mutation

      adapter.replaceAll([
        { id: 'x', value: 10, updatedAt: '' },
        { id: 'y', value: 20, updatedAt: '' },
      ])

      expect(adapter.findAll()).toHaveLength(2)
      expect(adapter.findById('x')?.value).toBe(10)
      expect(adapter.findById('a')).toBeUndefined()

      // replaceAll does NOT record mutations
      expect(adapter.queue.length).toBe(0)
    })
  })

  // ── initialData ────────────────────────────────────────────────────

  describe('initialData', () => {
    it('accepts initial data', () => {
      const a = new LocalAdapter<Counter>({
        tableName: 'test',
        idMode: 'client',
        disableIDB: true,
        mutationStorage: createMemoryStorage(),
        initialData: [
          { id: 'a', value: 1, updatedAt: '' },
          { id: 'b', value: 2, updatedAt: '' },
        ],
      })
      expect(a.findAll()).toHaveLength(2)
      expect(a.findById('a')?.value).toBe(1)
    })
  })

  // ── reset ──────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears data and queue', () => {
      adapter.insert({ id: 'a', value: 1, updatedAt: '' })
      adapter.reset()
      expect(adapter.findAll()).toHaveLength(0)
      expect(adapter.queue.length).toBe(0)
    })

    it('reset with data', () => {
      adapter.reset([{ id: 'x', value: 99, updatedAt: '' }])
      expect(adapter.findAll()).toHaveLength(1)
      expect(adapter.findById('x')?.value).toBe(99)
    })
  })

  // ── auto ID mode ───────────────────────────────────────────────────

  describe('auto idMode', () => {
    it('generates numeric IDs in auto mode', () => {
      const autoAdapter = new LocalAdapter<Counter>({
        tableName: 'auto',
        idMode: 'auto',
        disableIDB: true,
        mutationStorage: createMemoryStorage(),
      })

      const r1 = autoAdapter.insert({ value: 1, updatedAt: '' } as any)
      const r2 = autoAdapter.insert({ value: 2, updatedAt: '' } as any)

      expect(typeof r1.id).toBe('number')
      expect(typeof r2.id).toBe('number')
      expect(r2.id).toBeGreaterThan(r1.id as number)
    })
  })
})
