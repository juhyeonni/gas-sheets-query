/**
 * Fails a burst step when its own HTTP response was not a successful run.
 *
 * A GAS web app does not report failure with an HTTP status: `/exec` serves an
 * HTML error page ("Sorry, unable to open the file at this time.") with HTTP
 * 200, so `curl` exits 0 and the body silently replaces the JSON the harness
 * expected. That happened on run 33763577665: one of two parallel bursts came
 * back as HTML while its work had already been applied twice, and the step only
 * failed later, in the row-count check, reporting duplicate keys — which reads
 * exactly like a locking bug in the library instead of a transport failure.
 *
 * Usage: node assert-burst-response.mjs left.json right.json
 */
import { readFileSync } from 'node:fs'

let failed = false

for (const path of process.argv.slice(2)) {
  const raw = readFileSync(path, 'utf-8')

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error(
      `${path}: not JSON — /exec served an error page with HTTP 200. First 300 chars:\n${raw.slice(0, 300)}`
    )
    failed = true
    continue
  }

  console.log(`${path}: ${JSON.stringify(parsed)}`)

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    console.error(`${path}: the burst reported ${parsed.errors.length} error(s)`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
