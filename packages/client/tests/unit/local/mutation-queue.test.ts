/**
 * MutationQueue tests - merge algorithm + persistence
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MutationQueue } from '../../../src/local/mutation-queue.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface TestRow {
  id: string
  name: string
  value: number
}

/** In-memory storage mock */
function createMemoryStorage(): MutationStorage & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

describe('MutationQueue', () => {
  let queue: MutationQueue<TestRow>
  let storage: ReturnType<typeof createMemoryStorage>

  beforeEach(() => {
    storage = createMemoryStorage()
    queue = new MutationQueue<TestRow>({
      tableName: 'test',
      storage,
    })
  })

  // ── Basic operations ───────────────────────────────────────────────

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(queue.length).toBe(0)
      expect(queue.hasPending).toBe(false)
      expect(queue.getMerged()).toEqual([])
    })

    it('push records mutations', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      expect(queue.length).toBe(1)
      expect(queue.hasPending).toBe(true)
    })

    it('clear removes all mutations', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('update', 'b', { value: 2 })
      queue.clear()
      expect(queue.length).toBe(0)
      expect(queue.getMerged()).toEqual([])
    })

    it('clearForRows removes mutations for specific IDs', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('update', 'b', { value: 2 })
      queue.push('delete', 'c')
      queue.clearForRows(new Set(['a', 'c']))
      expect(queue.length).toBe(1)
      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0].id).toBe('b')
    })
  })

  // ── Merge rules ────────────────────────────────────────────────────

  describe('merge rules', () => {
    it('insert + update → insert (data merged)', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('update', 'a', { value: 10 })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'a',
        type: 'insert',
        data: { id: 'a', name: 'Alice', value: 10 },
      })
    })

    it('insert + delete → noop (cancel out)', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('delete', 'a')

      const merged = queue.getMerged()
      expect(merged).toHaveLength(0)
    })

    it('update + update → update (last wins, data merged)', () => {
      queue.push('update', 'a', { name: 'Bob' })
      queue.push('update', 'a', { value: 99 })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'a',
        type: 'update',
        data: { name: 'Bob', value: 99 },
      })
    })

    it('update + delete → delete', () => {
      queue.push('update', 'a', { name: 'Bob' })
      queue.push('delete', 'a')

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'a',
        type: 'delete',
      })
    })

    it('delete + insert → update (re-creation)', () => {
      queue.push('delete', 'a')
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Reborn', value: 42 })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'a',
        type: 'update',
        data: { id: 'a', name: 'Reborn', value: 42 },
      })
    })

    it('insert + delete + insert → insert (noop then re-insert via null path)', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('delete', 'a')
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice2', value: 2 })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      // After insert+delete → null, then null+insert → insert
      expect(merged[0].id).toBe('a')
      expect(merged[0].type).toBe('insert')
      expect(merged[0].data).toEqual({ id: 'a', name: 'Alice2', value: 2 })
    })
  })

  // ── Chain merges ───────────────────────────────────────────────────

  describe('chain merges', () => {
    it('multiple updates merge into single update', () => {
      queue.push('update', 'x', { name: 'A' })
      queue.push('update', 'x', { value: 1 })
      queue.push('update', 'x', { name: 'B' })
      queue.push('update', 'x', { value: 2, name: 'C' })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'x',
        type: 'update',
        data: { name: 'C', value: 2 },
      })
    })

    it('insert + multiple updates → single insert', () => {
      queue.push('insert', 'x', undefined, { id: 'x', name: 'Init', value: 0 })
      queue.push('update', 'x', { value: 1 })
      queue.push('update', 'x', { value: 2 })
      queue.push('update', 'x', { name: 'Final' })

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        id: 'x',
        type: 'insert',
        data: { id: 'x', name: 'Final', value: 2 },
      })
    })

    it('handles multiple independent rows', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'A', value: 1 })
      queue.push('insert', 'b', undefined, { id: 'b', name: 'B', value: 2 })
      queue.push('update', 'a', { value: 10 })
      queue.push('delete', 'b')

      const merged = queue.getMerged()
      expect(merged).toHaveLength(1) // 'b' cancelled out
      expect(merged[0]).toEqual({
        id: 'a',
        type: 'insert',
        data: { id: 'a', name: 'A', value: 10 },
      })
    })
  })

  // ── Persistence ────────────────────────────────────────────────────

  describe('localStorage persistence', () => {
    it('persists mutations to storage', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      expect(storage.store.has('gsquery:test:mutations')).toBe(true)
    })

    it('restores mutations from storage', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.push('update', 'a', { value: 10 })

      // Create new queue with same storage
      const queue2 = new MutationQueue<TestRow>({
        tableName: 'test',
        storage,
      })

      const merged = queue2.getMerged()
      expect(merged).toHaveLength(1)
      expect(merged[0].type).toBe('insert')
    })

    it('removes storage key on clear', () => {
      queue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      queue.clear()
      expect(storage.store.has('gsquery:test:mutations')).toBe(false)
    })

    it('handles corrupted storage gracefully', () => {
      storage.setItem('gsquery:test2:mutations', 'not-json')
      const queue2 = new MutationQueue<TestRow>({
        tableName: 'test2',
        storage,
      })
      expect(queue2.length).toBe(0)
    })

    it('works without storage (null)', () => {
      const noStorageQueue = new MutationQueue<TestRow>({
        tableName: 'nostorage',
        storage: undefined as any,
      })
      // Force no storage detection
      ;(noStorageQueue as any).storage = null

      noStorageQueue.push('insert', 'a', undefined, { id: 'a', name: 'Alice', value: 1 })
      expect(noStorageQueue.length).toBe(1)
    })
  })
})
