# GAS E2E Harness

Runs a golden test suite for `@gsquery/core` **inside a real Apps Script runtime against a real Google Spreadsheet** — the behaviors unit tests can only approximate with fakes:

- Real `USER_ENTERED` parsing semantics (formula-injection escaping round-trips, the #130 assumption)
- Real date/timezone cell coercion through `columnTypes`
- Real `LockService` contention (two parallel web-app calls bursting inserts into one sheet)
- Physical migration `addColumn` on a live sheet (header insert + single-pass backfill, #127)
- `DuplicateIdError`, batch write correctness, stale-index safety — all against the live API

The same suite also runs locally against the in-repo fakes (`local-check.test.ts`), so a red result in real GAS indicts a platform assumption, not the test code.

## Test spreadsheet

A dedicated spreadsheet already exists (owned by the repo owner):

- **Name**: `gsquery-e2e-test (DO NOT EDIT — automated GAS integration tests)`
- **ID**: `1q7ohGZIKdier53G87UqeS34tL1p5ldfw8-7pW8PZnLM` (the harness default; override with Script Property `GSQUERY_E2E_SPREADSHEET_ID`)

The harness creates sheets named `e2e_<runId>_*`, and deletes them after each run (`?action=cleanup` removes any leftovers).

## One-time setup (~10 minutes, needs your Google login)

1. **Create a standalone Apps Script project** at [script.google.com](https://script.google.com) named e.g. `gsquery-e2e-harness`, and copy its Script ID (Project Settings → IDs).
2. **Local push**:
   ```bash
   cd e2e/gas
   cp .clasp.json.example .clasp.json   # paste the Script ID
   pnpm --filter @gsquery/gas-e2e-harness build
   npx @google/clasp login               # one-time browser OAuth
   npx @google/clasp push --force
   ```
3. **First run in the editor**: open the project, run `runAllTests` once — this triggers the OAuth consent for the spreadsheet scope. Check the log for the JSON result.
4. **Deploy as web app** (for CI): `npx @google/clasp deploy -d "e2e web app"` (the manifest already sets *Execute as: me*, ***Access: only myself***). The `/exec` URL is `https://script.google.com/macros/s/<deploymentId>/exec`.
   Because access is locked to the owner, every non-browser call must carry `Authorization: Bearer <token>` — mint one with `node mint-token.mjs` (reads `~/.clasprc.json`). Optionally set Script Properties: `E2E_TOKEN` (defense-in-depth shared secret), `GSQUERY_E2E_SPREADSHEET_ID` (to point at a different sheet).
5. **Wire CI** (from a machine where steps 2–4 are done; uses the `gh` CLI):

   ```bash
   REPO=juhyeonni/gas-sheets-query
   gh variable set GAS_E2E_ENABLED -b true -R $REPO
   gh secret set GAS_E2E_URL   -b "https://script.google.com/macros/s/DEPLOYMENT_ID/exec" -R $REPO
   gh secret set GAS_E2E_TOKEN -b "your-token-or-empty" -R $REPO
   # Full mode (CI pushes the current checkout and redeploys before testing):
   gh secret set CLASPRC_JSON < ~/.clasprc.json                       # -R $REPO
   gh secret set CLASP_JSON   < e2e/gas/.clasp.json                   # -R $REPO
   gh secret set GAS_E2E_DEPLOYMENT_ID -b "AKfycb..." -R $REPO        # from `npx @google/clasp deployments`
   ```

   `CLASPRC_JSON` is always required — the web app is `access: MYSELF`, so CI mints a Bearer token from it for every request (`mint-token.mjs`). Modes:
   - **test-only** (`CLASPRC_JSON` + `GAS_E2E_URL`): tests whatever version is currently deployed.
   - **full** (also `CLASP_JSON` + `GAS_E2E_DEPLOYMENT_ID`): CI pushes the current checkout and re-versions the SAME deployment (`clasp deploy -i`) so the `/exec` URL serves the just-pushed code — without that redeploy, `clasp push` alone would leave the URL serving the old version.

   > If authenticated curls come back as a Google login page (HTML instead of JSON), the clasp token's scopes don't satisfy the web app's access check — re-run `npx @google/clasp login` with the stock client (its `drive.file` scope satisfies the check) and refresh the `CLASPRC_JSON` secret.

   > ⚠️ If the OAuth client behind `clasp login` belongs to a GCP project whose consent screen is in **Testing** mode, its refresh token dies every 7 days. The stock clasp client (Google's, production) does not have this problem.

Then: **Actions → "GAS E2E (real Apps Script)" → Run workflow.** It also runs automatically on every `dev` push that touches `packages/**` or `e2e/**`.

## What CI does

1. Mints an owner Bearer token from `CLASPRC_JSON` (the app is not publicly accessible).
2. *(full mode)* Bundles the harness (`esbuild` IIFE — library + tests in one `Code.js`), `clasp push`es it, and redeploys the web app to the new version.
3. `GET ?action=run` — full golden suite, asserts `ok: true` from the JSON report.
4. Fires two parallel `?action=burst&n=25` requests, then `?action=burstCheck&expect=50` — verifies the real script lock: 50 rows, 50 unique ids, no overwrites.
5. `?action=cleanup` — removes all `e2e_*` sheets.

## Calling the web app manually

```bash
ACCESS_TOKEN=$(node mint-token.mjs)
curl -sL -H "Authorization: Bearer $ACCESS_TOKEN" "$URL?action=run&token=$E2E_TOKEN" | python3 -m json.tool
```

## Local sanity check (no Google account needed)

```bash
pnpm --filter @gsquery/gas-e2e-harness test        # suite vs in-repo fakes
pnpm --filter @gsquery/gas-e2e-harness typecheck
pnpm --filter @gsquery/gas-e2e-harness build       # produces dist/Code.js
```

## Interpreting failures

| Symptom | Likely meaning |
|---|---|
| `formula escape` test fails only in GAS | The `USER_ENTERED` apostrophe assumption in `escapeCellValue`/`unescapeCellValue` doesn't match real Sheets — a real finding, fix the adapter |
| `burstCheck` reports duplicate ids | Real `LockService` isn't protecting the insert path — regression of #128 |
| `date columnType` fails only in GAS | Timezone/serial-number coercion differs from the fakes — extend `deserializeByType` |
| Suite green locally, HTTP error in CI | Deployment/auth issue (redeploy the web app, check token), not a library bug |
