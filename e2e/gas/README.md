# GAS E2E Harness

Runs a golden test suite for `@gsquery/core` **inside a real Apps Script runtime against a real Google Spreadsheet** — the behaviors unit tests can only approximate with fakes:

- Real `USER_ENTERED` parsing semantics (formula-injection escaping round-trips, the #130 assumption)
- Real date/timezone cell coercion through `columnTypes`
- Real `LockService` contention (two parallel web-app calls bursting inserts into one sheet)
- Physical migration schema ops on a live sheet (`addColumn` header insert + single-pass backfill, #127; `renameColumn` header-cell rewrite and `removeColumn` column delete, #180)
- `DuplicateIdError`, batch write correctness, stale-index safety — all against the live API

### Production scenarios

On top of the golden suite, four scenarios model what a real deployment does to a sheet:

| # | Scenario | Where | What it proves |
|---|---|---|---|
| S1 | **Mixed concurrent workload** | `?action=mixedBurst&tag=&seed=` ×2 in parallel, then `?action=mixedCheck` | Two callers each run 10 inserts + 5 updates + 3 deletes + 1 batchUpdate against one sheet. Each touches only its own rows and its op sets are disjoint, so the per-tag end state is fixed *whatever the interleaving*: 7 survivors, slots 0–1 `u`, slots 2–6 `b`, slots 7–9 gone. The check asserts that, plus no duplicate ids/keys and no **cross-tag contamination** (a row whose `key` no longer reconstructs from its own `tag`+`slot` was partially overwritten). `seed` shuffles op order to explore different interleavings without changing the end state. |
| S2 | **Human interference** | `?action=run` (3 tests) | People edit production sheets. Sorting the data range by a non-id column and inserting a blank row mid-table are both survivable (the adapter resolves rows by scanning the id column, and all-empty rows are filtered out). Inserting a **foreign column** mid-table is not — it is tagged `[documents #TBD]` and asserts the *current* failure mode rather than fixing it. |
| S3 | **Volume budget** | `?action=run` (1 test, one shared 2,000-row sheet) | batchInsert / findAll / filtered query / 200-row scattered batchUpdate / single update stay correct at 2k rows, within loose ceilings that only trip on an egregious blowup. Per-operation timings are reported in the result's `info` field. This test dominates the suite's wall clock. |
| S4 | **Live migration chain** | `?action=run` (1 test) | v1 `addColumn` → v2 `renameColumn` → v3 `removeColumn` driven synchronously in the order a chain would issue them, each version's store declaring the schema that version deploys. All three are physical (#127, #180): the header row is extended, then its cell rewritten in place, then the dropped column deleted outright — with the grid alignment, the post-op reads/writes and the byte-identical rerun asserted after every step. |

`Range.sort` and `Sheet.insertRowBefore` are not implemented by the fakes, so S2's first two probes feature-detect them and record a skip note in `info`; every other assertion in those tests still runs locally.

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
5. Fires two parallel `?action=mixedBurst` requests (S1), then `?action=mixedCheck` — verifies the mixed-workload invariants.
6. `?action=cleanup` — removes all `e2e_*` sheets.

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
| `mixedCheck` reports `contaminated` rows | A write landed on a row number resolved before a concurrent delete shifted it — the stale-index race of #128/#155 |
| `mixedCheck` reports `wrongStates`/`missingSlots` | An update, delete or batchUpdate was silently lost under contention |
| A `[documents #TBD]` test fails | The characterized behavior *changed* — re-read the assertion, then update it (or the issue) rather than "fixing" the test |
| `migration chain v1→v3` fails a header or alignment assertion | A schema op stopped being physical — regression of #127/#180. `renameColumn` must rewrite the header cell and move no data; `removeColumn` must delete the column so the post-removal schema keeps reading its own values |
| `volume` trips a time ceiling | A per-row write path crept back into a batch operation — the ceilings are ~10x the expected cost, not tight benchmarks |
| Suite green locally, HTTP error in CI | Deployment/auth issue (redeploy the web app, check token), not a library bug |
