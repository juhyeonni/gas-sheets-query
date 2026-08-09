/**
 * Mints a Google OAuth access token from clasp's stored credentials, so the
 * E2E web app can stay locked to `access: MYSELF` — callers authenticate with
 * `Authorization: Bearer <token>` instead of the app being public.
 *
 * Credential source: $CLASPRC_JSON (CI secret) or ~/.clasprc.json (local).
 * Handles both clasp credential layouts:
 *   v2: { token: { refresh_token }, oauth2ClientSettings: { clientId, clientSecret } }
 *   v3: { tokens: { default: { refresh_token, client_id, client_secret } } }
 *
 * Usage: node mint-token.mjs   → prints the access token to stdout.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function loadClasprc() {
  if (process.env.CLASPRC_JSON) return JSON.parse(process.env.CLASPRC_JSON)
  return JSON.parse(readFileSync(join(homedir(), '.clasprc.json'), 'utf8'))
}

/** Depth-first search for the first value under any of the given key names. */
function findKey(node, names) {
  if (node === null || typeof node !== 'object') return undefined
  for (const [key, value] of Object.entries(node)) {
    if (names.includes(key) && typeof value === 'string' && value.length > 0) return value
    const nested = findKey(value, names)
    if (nested !== undefined) return nested
  }
  return undefined
}

const rc = loadClasprc()
const refreshToken = findKey(rc, ['refresh_token', 'refreshToken'])
const clientId = findKey(rc, ['client_id', 'clientId'])
const clientSecret = findKey(rc, ['client_secret', 'clientSecret'])

if (!refreshToken || !clientId || !clientSecret) {
  console.error(
    'mint-token: could not find refresh_token/client_id/client_secret in clasp credentials. ' +
      'Run `npx @google/clasp login` and retry.'
  )
  process.exit(1)
}

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  })
})

const body = await res.json()
if (!res.ok || !body.access_token) {
  console.error(`mint-token: token endpoint returned ${res.status}: ${JSON.stringify(body)}`)
  process.exit(1)
}
process.stdout.write(body.access_token)
