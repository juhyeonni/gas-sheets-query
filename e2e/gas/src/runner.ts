/**
 * Minimal test runner for the GAS E2E harness.
 *
 * Kept dependency-free and synchronous-friendly so the same suite runs both
 * inside the Apps Script runtime (bundled, via doGet/runAllTests) and in Node
 * against the @gsquery/core/testing fakes (local sanity check).
 */

export interface TestResult {
  name: string
  ok: boolean
  error?: string
  ms: number
  /**
   * Free-form notes a test emitted via {@link TestApi.info} — per-operation
   * timings for the volume budget, "skipped under fakes" markers for the
   * human-interference probes. Reported alongside the result so a green CI run
   * still carries the numbers; never used for pass/fail.
   */
  info?: string
}

export interface SuiteResult {
  ok: boolean
  total: number
  passed: number
  failed: number
  durationMs: number
  results: TestResult[]
}

/** Handle passed to every test for attaching non-assertional notes. */
export interface TestApi {
  /** Record a note (timing, skip reason) on this test's result. */
  info(message: string): void
}

/**
 * Tests must be fully synchronous: the GAS web-app dispatcher rejects a
 * Promise returned from doGet ("returned value is not a supported return
 * type" — verified against the real platform), so nothing in the request
 * path may await.
 *
 * The {@link TestApi} argument is optional at the call site — tests that need
 * no notes keep the original `() => void` shape.
 */
type TestFn = (t: TestApi) => void

const registry: { name: string; fn: TestFn }[] = []

export function test(name: string, fn: TestFn): void {
  registry.push({ name, fn })
}

export function clearTests(): void {
  registry.length = 0
}

export function runSuite(): SuiteResult {
  const results: TestResult[] = []
  const suiteStart = Date.now()

  for (const { name, fn } of registry) {
    const start = Date.now()
    const notes: string[] = []
    // Notes survive a failure too: the timings/skips recorded before the throw
    // are usually what explains it.
    const api: TestApi = { info: (message: string) => { notes.push(message) } }
    const info = (): string | undefined => (notes.length > 0 ? notes.join(' | ') : undefined)
    try {
      fn(api)
      results.push({ name, ok: true, ms: Date.now() - start, info: info() })
    } catch (err) {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      results.push({ name, ok: false, error, ms: Date.now() - start, info: info() })
    }
  }

  const failed = results.filter(r => !r.ok).length
  return {
    ok: failed === 0,
    total: results.length,
    passed: results.length - failed,
    failed,
    durationMs: Date.now() - suiteStart,
    results
  }
}

// ── Assertions ──────────────────────────────────────────────────────────────

export function assertOk(condition: unknown, message: string): void {
  if (!condition) throw new Error(`assertOk failed: ${message}`)
}

/** Deep equality via JSON round-trip — sufficient for row objects and arrays. */
export function assertEq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`assertEq failed: ${message}\n  expected: ${e}\n  actual:   ${a}`)
  }
}

export function assertThrows(fn: () => unknown, errorNameOrCode: string, message: string): void {
  try {
    fn()
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string }
    if (e.name === errorNameOrCode || e.code === errorNameOrCode) return
    throw new Error(
      `assertThrows failed: ${message} — threw ${e.name ?? 'unknown'} (${e.message ?? ''}), expected ${errorNameOrCode}`
    )
  }
  throw new Error(`assertThrows failed: ${message} — did not throw`)
}
