# Fresh-Eyes Evaluation — gas-sheets-query @ dev (1.0.0-rc3)

> **Method**: Five independent evaluators, each starting with **zero prior knowledge** of this
> repository (no issue history, no fix context), each assigned one axis of a fixed rubric and the
> persona of *a senior TypeScript developer deciding in 1–2 hours whether to adopt this library
> for an internal GAS tool*. Evaluators ran the code, wrote and compiled their own experiment
> snippets, and were instructed to score "like your project depends on it."
> A sixth pass then **adversarially verified 20 factual claims** from their reports against the
> repo: 17 CONFIRMED, 3 PARTIAL (overstatement corrected), 0 REFUTED.
> Evaluated at commit `fb55065` (dev).

## 한국어 요약

가중 총점 **4.0 / 5** — 5명 전원이 "도입" 또는 "조건부 도입" 판정. 만장일치로 꼽힌 강점은
(1) 실패 모드를 정조준하는 1,200개 테스트와 실 GAS e2e, (2) 라이브 장애를 인용하는 주석 문화,
(3) 정직한 Limitations 문서. 공통 약점은 (1) **데모 경로(mock·codegen)는 타입 안전한데 실제
프로덕션 배선 경로에서 타입 시스템이 풀리는 것**, (2) JOIN·집계의 문자열 기반 표면,
(3) 소비자용 GAS 배포(번들→clasp) 문서 부재, (4) 1인 버스 팩터. 검증 과정에서 **date 컬럼
등호 비교가 절대 매치되지 않는 실제 버그**(신규)와 **codegen 산출물이 verbatimModuleSyntax
아래서 컴파일되지 않는 버그**(신규)가 확인됨.

## Scores

| Axis | Weight | Score | One-line basis |
|---|---|---|---|
| First impressions & onboarding | 20% | 4.0 | Quick-start ran verbatim first try; fakes undocumented cost the only real stuck time |
| API design & type safety | 20% | 3.5 | 14 misuse probes correctly rejected; but JOIN/agg untyped and README production wiring doesn't compile |
| Architecture & code quality | 15% | 4.5 | "Best comments I've seen in an OSS library this size"; drift risk in triplicated adapter logic |
| Reliability engineering | 20% | 4.0 | "The opposite of coverage theater"; e2e layer silently skippable, client IDB untested |
| Adoption risk | 15% | 3.5 | Zero-dep core, defensive publish pipeline; bus factor 1, RC with no visible changelog |
| Documentation accuracy | 10% | 4.5 | 5/5 sampled behavior claims TRUE against source; one stale SECURITY.md table |
| **Weighted total** | | **3.95 ≈ 4.0** | |

## Evaluator verdicts (verbatim)

- **Onboarding**: "This is the best first-hour experience I've had with a niche library in a while … I would adopt it for an internal tool."
- **API**: "Against raw SpreadsheetApp boilerplate this is clearly worth its weight … but I'd adopt it via the CLI codegen path only, and budget a day to fence off the stringly-typed corners."
- **Architecture**: "Adopt: this is disciplined, battle-scarred code whose every non-obvious line explains the production failure it prevents … the residual risks are drift risks, not design flaws."
- **Reliability**: "I would adopt `@gsquery/core` for single-writer-per-execution GAS workloads with confidence, while treating `@gsquery/client` multi-user sync as not production-ready until conflict detection (#138) lands."
- **Risk**: "Adopt for new GAS projects with eyes open … treat it as a single-maintainer RC — pin exact versions, vendor the ability to fork, and budget a day to work out the undocumented bundle-to-Apps-Script deployment path yourself."

**Consensus: 조건부 도입 (adopt with conditions).** The conditions named most often: use the
codegen or mock-first path, don't rely on client multi-user sync yet, and expect to self-serve
the GAS deployment last mile.

## What every evaluator independently praised

1. **Test culture aimed at failure modes, not coverage.** Files named after incidents
   (`flush-before-unlock`, `header-drift-guard`, `sheet-creation-race`), oracles that are
   themselves tested for vacuousness, a real-platform e2e harness with genuine lock-contention
   bursts, and comments citing live run IDs. One evaluator: "tests measure a real defect instead
   of hiding it" (two-client-convergence).
2. **Comment discipline.** WHY-comments with issue numbers and quantified live evidence
   ("2×25 locked inserts → 49 rows, both callers reporting success").
3. **Honest documentation.** README Limitations volunteers weaknesses; 5/5 sampled doc claims
   verified TRUE against source down to write-ordering details.
4. **Safe defaults.** Formula-injection escaping on by default, header-drift guard on by default,
   refusal to silently substitute MockAdapter in production, zero-dependency core.

## Confirmed findings (all verified against the repo; sorted by severity)

### High

| # | Finding | Evidence | Status |
|---|---|---|---|
| H1 | **README's production wiring does not compile.** `stores: { users: new SheetsAdapter({...}) }` under strict TS → TS2322 (`SheetsAdapter<RowWithId>` not assignable). The fix exists — `InferRowFromSchema` is exported (`core/src/index.ts:30`) — but is shown nowhere in README or wiki, so the flagship inference story breaks exactly at the production seam. | README.md:42; reproduced with tsc | **New** |
| H2 | **JOIN queries are effectively untyped end-to-end.** `JoinQueryBuilder.where()` accepts arbitrary strings (`join-query-builder.ts:121-123`); results are `T & Record<string, unknown>`. Same for legacy `createSheetsDB`, where `TableSchema<any>` (`types.ts:297`) lets typo'd column lists compile. | reproduced with tsc | **New** |
| H3 | **Client sync ships with characterized silent write loss** — no base version on the wire, conflicts undetectable, pure LWW; pinned by the library's own scenario tests. | `two-client-convergence.scenario.test.ts:10-15,391` | Known — #138 (open, by design pending protocol decision) |

### Medium

| # | Finding | Evidence | Status |
|---|---|---|---|
| M1 | **`columnTypes: 'date'` equality never matches**: values deserialize to `Date`, `where(col, '=', new Date(...))` compiles, but `evaluateCondition` uses `===` identity — 0 matches reproduced at runtime on SheetsAdapter and LocalAdapter. | `query-utils.ts:22-23`; runtime repro | **New — behavioral bug** |
| M2 | **CLI-generated `client.ts` fails under `verbatimModuleSyntax`**: emits a value-import of type-only `DataStore` → TS1484. The repo's own root tsconfig enables that flag as a guard (#134). | `client-generator.ts:27`; reproduced via real CLI + tsc | **New — codegen bug** |
| M3 | **The GAS deployment last mile is undocumented and unaddressable**: `dist/gas/bundle.js` is built but absent from the exports map; no consumer-facing page explains bundling/clasp. "For a library whose entire premise is GAS, the last mile to the target platform is undocumented." | `build.mjs:28-37`, `package.json` exports; doc grep | **New** |
| M4 | **Testing fakes are advertised (README:14) but documented nowhere** in website/docs or docs/ — cost the onboarding evaluator his only stuck time (15 min, incl. a silent-misuse trap in JS). | grep: zero hits across 24 doc pages | **New** |
| M5 | **Aggregation fails silently**: `AggSpec` accepts any column string, `sum()` on non-numeric returns 0, unknown `having()` alias passes all groups. | `query-builder.ts:15,196-202,393-394`; runtime repro | **New** |
| M6 | **Adapter correctness is a convention, not a contract**: >90 lines of index/query logic duplicated between MockAdapter and LocalAdapter; guard logic (e.g. client-id checks) triplicated. "Silent divergence between the mock and the real adapter is the failure mode this codebase is one refactor away from." | diff-verified functionally identical | **New (overlaps #156 in spirit)** |
| M7 | **Real-platform e2e is silently skippable**: `vars.GAS_E2E_ENABLED != 'true'` → job skips, skipped == green; runs only on dev pushes, never PRs. (Verifier narrowed: lapsed *secrets* fail red; only the *variable* skips silently.) | `gas-e2e.yml:26-34` | **New (CI hardening)** |
| M8 | **Client persistence never tested against a faithful IndexedDB** (node env, `disableIDB`, hand-rolled stubs, no fake-indexeddb). | client vitest.config, test files | Known — #143 (IDB path) |
| M9 | **Fetch transport has no auth hook** — REST/dev-mode consumers cannot attach credentials. | `gas-api-transport.ts:24-31,101,118-122` | Known-adjacent — fold into #140 |
| M10 | **Bus factor 1** on an RC: all contacts route to one personal address; the hardest-won knowledge (platform race fixes) lives in one head. | package.json authors, SECURITY.md:38 | Structural |

### Low

| # | Finding | Evidence | Status |
|---|---|---|---|
| L1 | SECURITY.md supported-versions table says `0.9.x` while the repo is at 1.0.0-rc3 | SECURITY.md:9-10 | **New — trivial fix** |
| L2 | No CHANGELOG.md despite release-please config referencing it (rc tags predate the pipeline; first release-please release will create it — verify then) | repo root | Check at 1.0.0 |
| L3 | SheetsAdapter outside GAS dies with raw `ReferenceError: SpreadsheetApp is not defined` — "the #1 mistake a newcomer will make" deserves a guided error | runtime repro | **New** |
| L4 | `create()` persists unknown extra fields silently (no runtime validation) — footgun for plain-JS GAS users | runtime repro | **New (documented-adjacent)** |
| L5 | `IndexDefinition.unique` accepted but never enforced (README:84 does disclose this) | runtime repro | Documented limitation |
| L6 | Placeholder `createClient` advertises `insert` where the real API is `create` (verifier narrowed: `update`/`delete` do match) | `client/src/index.ts:121-128` | **New — trivial** |
| L7 | Dead exports: `ValidationError`, `InvalidOperatorError` thrown nowhere; "ID is required in client mode" is a raw Error ×3 | errors.ts:113,181 | Known — #144 |
| L8 | Coverage PR comment posts core only; single Node version in CI | `tests-and-coverage.yml:41-47` | Known-adjacent — #143 |
| L9 | `types:` sample-value convention never explained; rc status unmentioned in README/installation | README.md:39 | **New — docs** |
| L10 | `ColumnType` imported by core from the adapter layer (type-only inverted dependency); `first()` mechanics differ between builders; `findByIdOrNull` returns `undefined` | types.ts:4 etc. | **New — hygiene** |

### Verifier corrections (claims that were overstated)

- **V1**: "no helper names the inferred row type" — false; `InferRowFromSchema` exists and works. The real gap is documentation + DX.
- **V15**: only `insert` (not `update`/`delete`) contradicts the real TableHandle API.
- **V17**: lapsed e2e *secrets* fail red; only the `GAS_E2E_ENABLED` *variable* produces a silent skip.

## Synthesis: the one pattern behind the findings

Four of the top findings (H1, H2, M5, and the legacy-config `any`) are the same phenomenon:
**type safety is strongest where the stakes are lowest.** The mock/quick-start/codegen paths are
rigorously inferred and were verified by three separate evaluators; the surfaces you reach for in
production — real-adapter wiring, JOINs, aggregation — are where inference quietly drops to
`string`/`unknown`/`any`. None of this corrupts data (the runtime guards catch sheet-level drift);
it erodes the compile-time promise that is the library's differentiation.

The second pattern: **documentation debt is concentrated at the two seams that matter most for
adoption** — getting the library *into* Apps Script (M3) and testing without GAS (M4). Both
stories are implemented and good; both are invisible.

## Issue-registration candidates (proposed, not yet filed)

1. `bug(core)`: date columnType `=` comparison never matches (M1) — value-compare dates in `evaluateCondition`
2. `bug(cli)`: generated client breaks under `verbatimModuleSyntax` (M2) — emit `import type`
3. `docs+dx(core)`: README production wiring doesn't compile; document `InferRowFromSchema`, consider a `stores` factory that closes the loop (H1)
4. `docs`: consumer GAS deployment guide + expose `./gas` in exports map (M3)
5. `docs`: testing-fakes wiki page (M4)
6. `enhancement(core)`: typed JOIN surface (H2) / typed AggSpec + loud `having` (M5) — possibly one "type-safety parity" epic
7. `dx(core)`: guided error when SpreadsheetApp is undefined (L3)
8. `chore`: SECURITY.md version table (L1), placeholder client `insert`→`create` (L6)
9. `ci`: make GAS_E2E_ENABLED skip loud (M7)
10. `refactor`: shared adapter conformance test suite (M6)

Existing open issues independently rediscovered by cold reviewers (validation that the backlog is
real): #138 (×2 evaluators), #143 (IDB), #144 (dead ValidationError), #140-adjacent (transport).
