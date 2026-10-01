/**
 * #238 - data-sized Math.max(...xs) spreads throw RangeError on large arrays.
 */
import { describe, it, expect } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

const N = 200_000

interface Row {
  id: number
}

function memoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

function rows(): Row[] {
  return Array.from({ length: N }, (_, i) => ({ id: i + 1 }))
}

function makeAdapter(initialData?: Row[]): LocalAdapter<Row> {
  return new LocalAdapter<Row>({
    tableName: 'T',
    idMode: 'auto',
    disableIDB: true,
    mutationStorage: memoryStorage(),
    initialData,
  })
}

describe('LocalAdapter large-array extremes (#238)', () => {
  it('construction with 200k initialData computes nextId', () => {
    const adapter = makeAdapter(rows())
    expect(adapter.insert({}).id).toBe(N + 1)
  })

  it('replaceAll of 200k rows computes nextId', () => {
    const adapter = makeAdapter()
    adapter.replaceAll(rows())
    expect(adapter.insert({}).id).toBe(N + 1)
  })

  it('reset over 200k rows and to empty', () => {
    const adapter = makeAdapter()
    adapter.reset(rows())
    expect(adapter.insert({}).id).toBe(N + 1)
    adapter.reset([])
    expect(adapter.insert({}).id).toBe(1)
  })
})
