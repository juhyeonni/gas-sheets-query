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
}

export interface SuiteResult {
  ok: boolean
  total: number
  passed: number
  failed: number
  durationMs: number
  results: TestResult[]
}

type TestFn = () => void | Promise<void>

const registry: { name: string; fn: TestFn }[] = []

export function test(name: string, fn: TestFn): void {
  registry.push({ name, fn })
}

export function clearTests(): void {
  registry.length = 0
}

export async function runSuite(): Promise<SuiteResult> {
  const results: TestResult[] = []
  const suiteStart = Date.now()

  for (const { name, fn } of registry) {
    const start = Date.now()
    try {
      await fn()
      results.push({ name, ok: true, ms: Date.now() - start })
    } catch (err) {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      results.push({ name, ok: false, error, ms: Date.now() - start })
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
