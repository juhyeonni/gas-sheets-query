/**
 * Runs one E2E step against the deployed web app, separating a lost response
 * from a real failure.
 *
 * A GAS web app does not report failure with an HTTP status. `/exec` 302s to
 * `script.googleusercontent.com`, and when that leg fails the body is an HTML
 * error page ("Sorry, unable to open the file at this time.") served with HTTP
 * 200 — or empty. `curl` exits 0 either way, so the harness used to parse the
 * page as its payload: three of five consecutive runs lost a response this way
 * (33763577665 left burst, 33769402381 right burst, 33770208188 golden suite).
 * Long requests are the ones that lose it; the redirect's one-time token does
 * not outlive them.
 *
 * The distinction this script draws:
 *
 * - Not JSON  → the response was lost. The work may well have been applied (in
 *   33763577665 it was applied twice), so the *step* is retried from a clean
 *   slate rather than the single request being re-fired. `cleanup` drops every
 *   `e2e_*` sheet, so each attempt's checks only ever see its own writes.
 * - JSON reporting failure → a real regression. Fails immediately; retrying
 *   would just hide it.
 *
 * Every retry leaves a warning annotation, so a flake stays visible instead of
 * being silently absorbed.
 *
 * The burst pairs stay genuinely parallel — firing them one after the other
 * would remove the concurrency they exist to test.
 *
 * Usage: node exec-step.mjs golden|burst|mixed
 * Env:   URL (web app /exec), ACCESS_TOKEN (bearer), TOKEN (shared secret)
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const ATTEMPTS = 3

/** Grace period before a retry wipes the sheets, for a still-running execution. */
const STRAGGLER_WAIT_MS = 20_000

const { URL: BASE_URL, ACCESS_TOKEN, TOKEN = '' } = process.env

if (!BASE_URL) throw new Error('exec-step: URL is not set')
if (!ACCESS_TOKEN) throw new Error('exec-step: ACCESS_TOKEN is not set')

/**
 * One GET against the web app.
 *
 * Shells out to `curl` rather than using `fetch`: the redirect to
 * `script.googleusercontent.com` is cross-origin, and the fetch spec strips
 * `Authorization` across origins — which this deployment (`access: MYSELF`)
 * answers with a login page. `curl -L` resends the header.
 */
async function get(query) {
  const { stdout } = await execFileAsync(
    'curl',
    ['-sSL', '-H', `Authorization: Bearer ${ACCESS_TOKEN}`, `${BASE_URL}?${query}&token=${TOKEN}`],
    { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }
  )
  return stdout
}

/** Thrown when a response body was not JSON — the response was lost. */
class LostResponse extends Error {
  constructor(label, raw) {
    super(`${label}: response was not JSON (${raw.length} bytes). First 200 chars:\n${raw.slice(0, 200)}`)
    this.name = 'LostResponse'
  }
}

async function getJson(label, query) {
  const raw = await get(query)
  try {
    return JSON.parse(raw)
  } catch {
    throw new LostResponse(label, raw)
  }
}

/** Fails the step when a parsed response reports failure of its own. */
function assertReported(label, payload, { requireOk = false } = {}) {
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`${label}: reported ${payload.errors.length} error(s): ${JSON.stringify(payload.errors)}`)
  }
  if (requireOk && payload.ok !== true) {
    throw new Error(`${label}: reported ok=${payload.ok}\n${JSON.stringify(payload, null, 2)}`)
  }
}

/** Fires two burst requests at once, then verifies the pair with `checkQuery`. */
async function burstPair(label, leftQuery, rightQuery, checkQuery) {
  await get('action=cleanup')

  // Both in flight together: sequential calls would not contend for the
  // script lock, which is the entire point of these two steps.
  //
  // allSettled, not all: a rejection must not return control while the other
  // request is still in flight. The retry starts by deleting every e2e_* sheet,
  // and doing that under a still-running burst would corrupt the next attempt's
  // invariants — reported as a data bug, which is the confusion being removed.
  const settled = await Promise.allSettled([
    getJson(`${label} left`, leftQuery),
    getJson(`${label} right`, rightQuery)
  ])
  const failure = settled.find(r => r.status === 'rejected')
  if (failure) throw failure.reason
  const [left, right] = settled.map(r => r.value)
  console.log(`${label} left:  ${JSON.stringify(left)}`)
  console.log(`${label} right: ${JSON.stringify(right)}`)
  assertReported(`${label} left`, left)
  assertReported(`${label} right`, right)

  const check = await getJson(`${label} check`, checkQuery)
  console.log(JSON.stringify(check, null, 2))
  assertReported(`${label} check`, check, { requireOk: true })
}

const STEPS = {
  async golden() {
    // runAll() mints its own runId and deletes its own sheets, so a retry
    // never collides with an abandoned attempt.
    const result = await getJson('golden suite', 'action=run')
    console.log(JSON.stringify(result, null, 2))
    assertReported('golden suite', result, { requireOk: true })
  },

  burst() {
    return burstPair(
      'burst',
      'action=burst&tag=left&n=25',
      'action=burst&tag=right&n=25',
      'action=burstCheck&expect=50'
    )
  },

  mixed() {
    return burstPair(
      'mixed',
      'action=mixedBurst&tag=left&seed=11',
      'action=mixedBurst&tag=right&seed=29',
      'action=mixedCheck&tags=left,right'
    )
  }
}

const mode = process.argv[2]
const step = STEPS[mode]
if (!step) throw new Error(`exec-step: unknown mode "${mode}" (expected golden|burst|mixed)`)

for (let attempt = 1; ; attempt++) {
  try {
    await step()
    process.exit(0)
  } catch (error) {
    if (!(error instanceof LostResponse)) {
      // A reported failure is the step's result, not a crash — print it as a
      // message rather than a stack trace nobody reads.
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }

    console.error(error.message)
    if (attempt >= ATTEMPTS) {
      console.log(
        `::error title=${mode} unreachable::${ATTEMPTS} attempts in a row lost their response; the web app never answered with JSON.`
      )
      process.exit(1)
    }
    console.log(
      `::warning title=${mode} transport flake::attempt ${attempt}/${ATTEMPTS} lost a response (/exec served a non-JSON body with HTTP 200) — retrying from a clean slate. See #140.`
    )
    // A lost response says nothing about the execution behind it, which may
    // still be writing. Let a straggler finish before the retry's cleanup.
    await new Promise(resolve => setTimeout(resolve, STRAGGLER_WAIT_MS))
  }
}
