# Fresh-Eyes Evaluation, Round 2 — gas-sheets-query @ dev (170c0fb, 1.0.0-rc3)

> **Method**: identical to round 1 (docs/reviews/fresh-eyes-evaluation-2026-08.md) — five independent
> zero-context evaluators, same rubric/personas/prompts, blind to round 1 and to issue history;
> then adversarial verification of every NEW High/Medium claim (9 checked: 8 CONFIRMED, 1 PARTIAL).
> Evaluated after the round-1 remediation landed (PRs #189, #196).

## 한국어 요약

가중 총점 **4.0/5 — 6축 전부 1차와 동점**. 점수가 안 움직인 이유는 명확합니다: 1차 지적을 고친
자리가 전부 "해소됨"으로 확인됐지만(아래 델타 표), 콜드 리뷰가 더 깊이 파면서 **1차가 못 본
신규 결함**을 같은 무게만큼 찾아냈습니다. 그중 둘은 HIGH입니다 — ① 배포 `.d.ts`가
`moduleResolution: nodenext`에서 깨지고 `skipLibCheck`와 결합하면 **전체 API가 조용히 `any`가
됨**(재현 확인), ② 스키마 DSL의 `@default(now)`/`@updatedAt`가 **문서에는 동작하는 것으로
서술되어 있으나 어디에서도 구현되지 않음**(재현 확인). 둘 다 v1.0 전에 처리할 가치가 있는
릴리스 관련 결함입니다.

## Scores — round 2 vs round 1

| Axis | Weight | R1 | R2 | Δ |
|---|---|---|---|---|
| First impressions & onboarding | 20% | 4.0 | 4.0 | = |
| API design & type safety | 20% | 3.5 | 3.5 | = |
| Architecture & code quality | 15% | 4.5 | 4.5 | = |
| Reliability engineering | 20% | 4.0 | 4.0 | = |
| Adoption risk | 15% | 3.5 | 3.5 | = |
| Documentation accuracy | 10% | 4.5 | 4.5 | = |
| **Weighted total** | | **3.95** | **3.95** | = |

Same numbers, different content: the round-1 defects are gone from the reports; the score ceiling
is now held by newly surfaced issues (below) plus the structural items no code change moves
(bus factor, RC status, client sync #138).

## Round-1 findings: resolution check (as seen by blind round-2 evaluators)

| R1 finding | R2 evidence of resolution |
|---|---|
| H1 README production wiring didn't compile | API evaluator: production wiring "compiles clean", 12/12 misuse probes correctly rejected; onboarding ran quick-start verbatim first try |
| M1 date `=` never matched | Not re-reported by any evaluator (regression suite in place) |
| M2 codegen TS1484 | Source emits `type DataStore` (only a stale gitignored local `cli/dist` still shows the old output — npm consumers protected by `prepublishOnly`) |
| M3 GAS deployment last mile undocumented | Risk evaluator: "The GAS delivery story is credible … the question most GAS libraries fumble; this one answers it correctly" |
| M4 testing fakes undocumented | Onboarding ran `testing.md` verbatim ("FAKES OK") and praised the FakeSpreadsheet-constructor warning callout |
| L1 SECURITY.md 0.9.x table | R2 quotes the corrected 1.0.x table |
| L3 raw ReferenceError outside GAS | API evaluator lists the guided error as a positive guardrail |
| L6 placeholder `insert` | Not re-reported |
| M7 silent e2e skip | `gate-check` noted ("thoughtful, but a warning is ignorable" — accepted residual) |

**All nine remediated items verified resolved by evaluators who did not know they had been fixed.**

## New findings (round 2 only; all adversarially verified)

### High

| # | Finding | Evidence | Note |
|---|---|---|---|
| W1 | **Shipped `.d.ts` breaks under `moduleResolution: nodenext`/`node16`** (extensionless relative imports → TS2834), and with `skipLibCheck: true` — the most common consumer combo — **every export silently types as `any`** (`const x: "NOT ANY" = defineSheetsDB` compiles). `bundler` and `node10` resolutions work. | Reproduced both ways against built dist; `dist/types/index.d.ts:5-30` | **Release-relevant packaging bug**: voids the "Type-safe" headline for standard Node-ESM consumers, and fails silently. No doc states the tsconfig requirement. |
| W2 | **Schema DSL `@default(now)` / `@updatedAt` are parsed, displayed, and documented as functional — but implemented nowhere**: generated `create()` requires the fields; no adapter applies defaults. README's Limitations discloses `@unique`/`@@index` as declarative-only but NOT `@default`; `schema-definition.md` says `@updatedAt` "automatically updates". | Real CLI run + grep of all adapters; `website/docs/schema-definition.md:95-101` | Docs-vs-code drift of the worst kind (promises behavior). Fix = implement or disclose. |

### Medium

| # | Finding | Evidence | Note |
|---|---|---|---|
| W3 | Nullable/optional columns are **inexpressible** in `defineSheetsDB`'s sample-value system: `null` sample infers type `null` (unusable); no union/optional syntax | `types.ts:176-182`; tsc repro | Schema-expressiveness gap; design work (v1.x) |
| W4 | README "a deleted row's id is **never** reused" + id-modes "safe to lose" **overclaim**: meta sheet deleted AND max rows deleted before next insert → id IS re-issued (runtime-reproduced: got id 3, control got 4) | `allocateAutoIds` bootstrap; runtime repro | One-paragraph docs wording fix — state the window |
| W6 | Aggregation result type claims **all** columns of T as group keys regardless of `groupBy()` — phantom keys typecheck (as `unknown`), don't exist at runtime | `query-builder.ts:57,266`; tsc+runtime repro | Fold into #194 (agg typing) |
| W7 | `SheetsAdapterOptions.columns: string[]` untied to `T`; with default `createIfNotExists` a typo'd list **creates the sheet with wrong headers**, and the header guard is self-referential so it can never catch it | tsc + fakes runtime repro | Fold into #194 (or `columns?: (keyof T & string)[]` tightening) |
| — | Dual factory API (`createSheetsDB` legacy + `defineSheetsDB`) with deprecated-at-birth options entering 1.0; QueryBuilder/JoinQueryBuilder ~180-line duplication with `first()` style drift (verified: no observable behavioral difference) | arch report | Surface-debt decision before 1.0: keep, or deprecate legacy factory in docs |

### Low

- W9: apostrophe+trigger strings (`'=note`) lose one char on the real-Sheets round trip per code-read; the in-source comment claims otherwise, and **the e2e formula test does not cover this input** — add `'=note` to the e2e escape test to settle it on the live platform.
- CLI `dist` staleness is local-only (gitignored; npm protected) — non-issue beyond rebuilding.
- Client coverage floor 58-66% (known, #143-adjacent); e2e never runs on PRs (accepted design).

## Structural items unchanged (no code fixes move these)

Bus factor 1 · RC with no shipped stable release/CHANGELOG yet (created by release-please at 1.0.0) ·
client multi-user sync = documented LWW loss (#138) · GAS-platform inherent limits.

## Verdicts (verbatim)

- Onboarding: "Best-documented onboarding I've seen in a hobby-scale library … adopt with `moduleResolution: bundler` and it earns its 4/5."
- API: "Adopt it for typed single-table CRUD on GAS … treat JOINs, aggregation, and the schema DSL's defaults as untyped conveniences you must verify yourself."
- Architecture: "The rare hobby-scale library whose core is written to production-database standards … budgeting one consolidation pass."
- Reliability: "I'd adopt @gsquery/core on that evidence … core-only adoption is a much safer bet than the full local-first stack."
- Risk: "Adopt cautiously … pin the rc version, wrap it behind your own adapter interface."

**Consensus: 조건부 도입 유지.** Conditions shifted from "docs gaps" (R1) to "packaging + marquee-feature typing" (R2).

## Issue-registration candidates

1. `bug(core, release-relevant)`: W1 — d.ts unusable under nodenext, silent `any` with skipLibCheck. Options: emit declarations with explicit extensions, or bundle d.ts to one file. **Recommend fixing before v1.0.**
2. `bug(cli+docs)`: W2 — `@default`/`@updatedAt` promised but unimplemented. Minimum viable: disclose in Limitations + generate `?` for `@default` fields; full: apply defaults at insert. **Disclosure before v1.0; implementation v1.x.**
3. `docs`: W4 — soften "never reused" to name the meta-deleted+max-deleted window (one paragraph).
4. `#194 append`: W6 (agg group-key type), W7 (columns untied to T).
5. `enhancement`: W3 — nullable column expressiveness (v1.x design).
6. `e2e`: W9 — add `'=note` to the formula-escape golden test; fix `unescapeCellValue` comment or behavior per live result.
