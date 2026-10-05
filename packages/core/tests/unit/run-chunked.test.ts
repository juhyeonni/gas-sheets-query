/**
 * #136 — `runChunked`: a batch job too large for one 6-minute GAS execution
 * stops cleanly before the deadline and resumes from a cursor.
 *
 * Time is driven with Vitest's fake clock: `write` advances `Date.now()` by
 * however long the chunk is supposed to take, so every stopping decision the
 * runner makes is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runChunked,
  DEFAULT_CHUNK_BUDGET_MS,
  DEFAULT_CHUNK_SIZE,
  QuotaExceededError,
  SheetsAdapter,
  ValidationError
} from '../../src'
import type { ChunkProgress } from '../../src'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'

const T0 = 1_000_000

/** Advance the fake clock, as a chunk that takes `ms` would. */
function spend(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runChunked defaults', () => {
  it('defaults to a 5.5-minute budget and 500-item chunks', () => {
    expect(DEFAULT_CHUNK_BUDGET_MS).toBe(330_000)
    expect(DEFAULT_CHUNK_SIZE).toBe(500)

    const calls: number[] = []
    const result = runChunked(range(1200), (chunk, offset) => {
      calls.push(offset)
      return chunk.length
    }, { startedAt: T0 })

    expect(calls).toEqual([0, 500, 1000])
    expect(result.results).toEqual([500, 500, 200])
  })
})

describe('runChunked without deadline pressure (AC1)', () => {
  it('writes every chunk in input order with its offset and reports done', () => {
    const items = range(10)
    const seen: { chunk: number[]; offset: number }[] = []

    const result = runChunked(items, (chunk, offset) => {
      seen.push({ chunk: [...chunk], offset })
      return `chunk@${offset}`
    }, { startedAt: T0, chunkSize: 4 })

    expect(seen).toEqual([
      { chunk: [0, 1, 2, 3], offset: 0 },
      { chunk: [4, 5, 6, 7], offset: 4 },
      { chunk: [8, 9], offset: 8 }
    ])
    expect(result).toEqual({
      done: true,
      next: items.length,
      results: ['chunk@0', 'chunk@4', 'chunk@8']
    })
  })

  it('reports an empty job as done without calling write', () => {
    const write = vi.fn()
    expect(runChunked([], write, { startedAt: T0 })).toEqual({ done: true, next: 0, results: [] })
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a job already finished by startAt as done without calling write', () => {
    const write = vi.fn()
    expect(runChunked(range(3), write, { startedAt: T0, startAt: 3 })).toEqual({
      done: true,
      next: 3,
      results: []
    })
    expect(write).not.toHaveBeenCalled()
  })
})

describe('runChunked under deadline pressure', () => {
  it('stops partway and points next at the first unwritten item (AC2)', () => {
    const items = range(100)
    const written: number[] = []

    // 10s per chunk against a 35s budget: chunks start at 0s, 10s, 20s; the
    // fourth would start at 30s and end at 40s, past the deadline.
    const result = runChunked(items, chunk => {
      written.push(...chunk)
      spend(10_000)
      return chunk.length
    }, { startedAt: T0, budgetMs: 35_000, chunkSize: 10 })

    expect(result.done).toBe(false)
    expect(result.next).toBe(30)
    expect(result.results).toEqual([10, 10, 10])
    expect(written).toEqual(range(30))
  })

  it('never calls write when the deadline has already passed (AC3)', () => {
    vi.setSystemTime(T0 + 400_000)
    const write = vi.fn()

    const result = runChunked(range(10), write, { startedAt: T0, startAt: 4 })

    expect(write).not.toHaveBeenCalled()
    expect(result).toEqual({ done: false, next: 4, results: [] })
  })

  it('treats a deadline reached exactly as passed', () => {
    vi.setSystemTime(T0 + 1_000)
    const write = vi.fn()

    expect(runChunked(range(3), write, { startedAt: T0, budgetMs: 1_000 })).toEqual({
      done: false,
      next: 0,
      results: []
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('starts the first chunk whenever time remains, with nothing measured yet', () => {
    // Only 1s left, and the chunk takes 5s: the runner cannot know that before
    // it has measured one, so the first chunk still runs.
    vi.setSystemTime(T0 + 9_000)
    const offsets: number[] = []

    const result = runChunked(range(6), (chunk, offset) => {
      offsets.push(offset)
      spend(5_000)
    }, { startedAt: T0, budgetMs: 10_000, chunkSize: 2 })

    expect(offsets).toEqual([0])
    expect(result).toEqual({ done: false, next: 2, results: [undefined] })
  })

  it('skips a chunk when now plus the slowest chunk so far would pass the deadline (AC4)', () => {
    // Durations 1s, 6s, 1s against a 10s budget:
    //   chunk 0 starts at 0s  (nothing measured)          -> ends 1s
    //   chunk 1 starts at 1s  (1s + slowest 1s = 2s <= 10) -> ends 7s
    //   chunk 2 would start at 7s, 7s + slowest 6s = 13s > 10s -> stop
    // Chunk 2 would in fact take only 1s, but the runner cannot know that.
    const durations = [1_000, 6_000, 1_000, 1_000]
    const offsets: number[] = []

    const result = runChunked(range(8), (chunk, offset) => {
      offsets.push(offset)
      spend(durations[offsets.length - 1])
    }, { startedAt: T0, budgetMs: 10_000, chunkSize: 2 })

    expect(offsets).toEqual([0, 2])
    expect(result.done).toBe(false)
    expect(result.next).toBe(4)
  })

  it('uses the slowest chunk measured, not the most recent one (AC4)', () => {
    // Durations 5s, 1s, ... against a 12s budget:
    //   chunk 0 at 0s -> 5s; chunk 1 at 5s (5 + 5 = 10 <= 12) -> 6s
    //   chunk 2 at 6s: last chunk took 1s (6 + 1 = 7 would fit), but the
    //   slowest took 5s (6 + 5 = 11 <= 12) -> runs, ends 7s
    //   chunk 3 at 7s: 7 + 5 = 12 <= 12 -> runs, ends 8s
    //   chunk 4 at 8s: 8 + 5 = 13 > 12 -> stop, although 8 + 1 = 9 would fit
    const durations = [5_000, 1_000, 1_000, 1_000, 1_000, 1_000]
    const offsets: number[] = []

    const result = runChunked(range(12), (chunk, offset) => {
      offsets.push(offset)
      spend(durations[offsets.length - 1])
    }, { startedAt: T0, budgetMs: 12_000, chunkSize: 2 })

    expect(offsets).toEqual([0, 2, 4, 6])
    expect(result).toMatchObject({ done: false, next: 8 })
  })

  it('counts time spent in onChunk as part of the chunk', () => {
    // write is instant, persisting the cursor takes 4s: the measured chunk is
    // 4s, so after chunk 1 ends at 8s, 8 + 4 = 12 > 10 stops the run.
    const offsets: number[] = []

    const result = runChunked(range(10), (chunk, offset) => {
      offsets.push(offset)
    }, {
      startedAt: T0,
      budgetMs: 10_000,
      chunkSize: 2,
      onChunk: () => spend(4_000)
    })

    expect(offsets).toEqual([0, 2])
    expect(result).toMatchObject({ done: false, next: 4 })
  })
})

describe('runChunked resume (AC5)', () => {
  it('finishes the job from next, writing every item exactly once across both calls', () => {
    const items = range(25)
    const writes = new Map<number, number>()
    const write = (chunk: number[]) => {
      for (const item of chunk) writes.set(item, (writes.get(item) ?? 0) + 1)
      spend(10_000)
      return chunk.length
    }

    const first = runChunked(items, write, { startedAt: T0, budgetMs: 25_000, chunkSize: 4 })
    expect(first.done).toBe(false)
    expect(first.next).toBeGreaterThan(0)
    expect(first.next).toBeLessThan(items.length)

    // A later execution: a fresh startedAt, same items, resumed at the cursor.
    const secondStart = Date.now() + 60_000
    vi.setSystemTime(secondStart)
    const second = runChunked(items, write, {
      startedAt: secondStart,
      budgetMs: 1_000_000,
      chunkSize: 4,
      startAt: first.next
    })

    expect(second).toMatchObject({ done: true, next: items.length })
    expect([...writes.keys()].sort((a, b) => a - b)).toEqual(items)
    expect([...writes.values()].every(count => count === 1)).toBe(true)
  })

  it('passes offsets relative to the whole item list, not to startAt', () => {
    const offsets: number[] = []
    runChunked(range(9), (chunk, offset) => {
      offsets.push(offset)
    }, { startedAt: T0, chunkSize: 3, startAt: 3 })

    expect(offsets).toEqual([3, 6])
  })
})

describe('runChunked onChunk (AC6)', () => {
  it('reports each completed chunk with its cursor and result', () => {
    const progress: ChunkProgress<string>[] = []

    runChunked(range(5), (chunk, offset) => `r${offset}`, {
      startedAt: T0,
      chunkSize: 2,
      onChunk: p => progress.push({ ...p })
    })

    expect(progress).toEqual([
      { next: 2, result: 'r0' },
      { next: 4, result: 'r2' },
      { next: 5, result: 'r4' }
    ])
  })

  it('is never called for a chunk whose write threw', () => {
    const progress: number[] = []
    const failure = new Error('boom')

    expect(() =>
      runChunked(range(6), (chunk, offset) => {
        if (offset === 2) throw failure
        return offset
      }, { startedAt: T0, chunkSize: 2, onChunk: p => progress.push(p.next) })
    ).toThrow(failure)

    expect(progress).toEqual([2])
  })
})

describe('runChunked partial-batch failure (AC7)', () => {
  let handle: GasFakesHandle | undefined

  afterEach(() => handle?.restore())

  it('propagates the same error object and runs no later chunk', () => {
    const failure = new Error('write failed')
    const offsets: number[] = []

    let caught: unknown
    try {
      runChunked(range(10), (chunk, offset) => {
        offsets.push(offset)
        if (offset === 4) throw failure
      }, { startedAt: T0, chunkSize: 2 })
    } catch (e) {
      caught = e
    }

    expect(caught).toBe(failure)
    expect(offsets).toEqual([0, 2, 4])
  })

  it('resumes from the last reported cursor after a failed chunk and ends with every row exactly once', () => {
    const SPREADSHEET_ID = 'run-chunked-partial-failure'
    const spreadsheet = fromArrays({ Users: [['id', 'name']] })
    handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
    const sheet = spreadsheet.getSheetByName('Users')
    if (!sheet) throw new Error('sheet missing')

    // The third setValues on the data sheet hits a daily quota: not retried,
    // so the batchInsert for that chunk fails having written nothing.
    let setValuesCalls = 0
    const originalGetRange = sheet.getRange.bind(sheet)
    sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
      const target = originalGetRange(row, col, numRows, numCols)
      const setValues = target.setValues.bind(target)
      target.setValues = (values: unknown[][]) => {
        setValuesCalls++
        if (setValuesCalls === 3) {
          throw new Error('Service invoked too many times for one day: spreadsheets.')
        }
        return setValues(values)
      }
      return target
    }

    interface User { id: string; name: string; [key: string]: unknown }
    const adapter = new SheetsAdapter<User>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: 'Users',
      columns: ['id', 'name'],
      idMode: 'client'
    })
    const items: User[] = range(10).map(i => ({ id: `u${i}`, name: `user ${i}` }))

    // The cursor a real handler would persist (e.g. in PropertiesService).
    let savedCursor = 0
    const options = { startedAt: T0, chunkSize: 3, onChunk: (p: ChunkProgress<User[]>) => { savedCursor = p.next } }

    let thrownByWrite: unknown
    let caught: unknown
    try {
      runChunked(items, chunk => {
        try {
          return adapter.batchInsert(chunk)
        } catch (e) {
          thrownByWrite = e
          throw e
        }
      }, options)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(QuotaExceededError)
    expect(caught).toBe(thrownByWrite)
    expect(savedCursor).toBe(6)

    // The next execution resumes from the saved cursor.
    const resumed = runChunked(items, chunk => adapter.batchInsert(chunk), {
      ...options,
      startAt: savedCursor
    })
    expect(resumed).toMatchObject({ done: true, next: items.length })

    adapter.clearCache()
    const ids = adapter.findAll().map(u => u.id)
    expect(ids).toEqual(items.map(u => u.id))
    expect(new Set(ids).size).toBe(items.length)
  })
})

describe('runChunked option validation (AC8)', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['chunkSize 0', { chunkSize: 0 }],
    ['negative chunkSize', { chunkSize: -1 }],
    ['fractional chunkSize', { chunkSize: 1.5 }],
    ['NaN chunkSize', { chunkSize: Number.NaN }],
    ['infinite chunkSize', { chunkSize: Number.POSITIVE_INFINITY }],
    ['negative startAt', { startAt: -1 }],
    ['startAt past the end', { startAt: 4 }],
    ['fractional startAt', { startAt: 1.5 }],
    ['NaN startAt', { startAt: Number.NaN }],
    ['non-finite startedAt', { startedAt: Number.NaN }],
    ['negative budgetMs', { budgetMs: -1 }],
    ['NaN budgetMs', { budgetMs: Number.NaN }]
  ]

  it.each(bad)('rejects %s before write is called', (_label, override) => {
    const write = vi.fn()
    const options = { startedAt: T0, ...override } as Parameters<typeof runChunked>[2]

    expect(() => runChunked(range(3), write, options)).toThrow(ValidationError)
    expect(write).not.toHaveBeenCalled()
  })

  it('accepts startAt equal to items.length', () => {
    expect(() => runChunked(range(3), vi.fn(), { startedAt: T0, startAt: 3 })).not.toThrow()
  })

  it('rejects invalid options even when the deadline has already passed', () => {
    vi.setSystemTime(T0 + 1_000_000)
    expect(() => runChunked(range(3), vi.fn(), { startedAt: T0, chunkSize: 0 })).toThrow(ValidationError)
  })
})
