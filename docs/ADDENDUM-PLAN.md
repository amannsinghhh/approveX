# Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine

> Roadmap for the second companion addendum (Part A: Guided UI Layer; Part B: Exhaustive
> Rule Engine Catalog, replacing master-prompt §5). The "where the code stands" table below
> is a snapshot of commit `44cd25e`, before any addendum work.
> **Status: M1–M5 all shipped — the addendum plan is complete.** The three open decisions (bottom) are confirmed.

## Where the code stands today

| Area                                                          | Today                                                                                                                         | Gap vs. addendum                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operators** (`shared/src/rule-evaluator/types.ts`) | 15: `= != > >= < <= IN NOT_IN CONTAINS STARTS_WITH ENDS_WITH BETWEEN IS_NULL IS_NOT_NULL MATCHES_REGEX`                       | ~25 missing: `NOT_BETWEEN MULTIPLE_OF WITHIN_PERCENT_OF NOT_CONTAINS IS_EMPTY EQUALS_IGNORE_CASE IN_IGNORE_CASE`, all date ops (`BEFORE/AFTER/ON/WITHIN_*_DAYS/OLDER_THAN_N_DAYS/DAY_OF_WEEK_IN/TIME_OF_DAY_BETWEEN`), array (`CONTAINS_ALL/ANY/LENGTH_*/ANY_ITEM_MATCHES/ALL_ITEMS_MATCH`), `EXISTS/NOT_EXISTS`, `IN_LIST/NOT_IN_LIST` |
| **AST node**                                                  | `{ field, operator, value }` — value is always a literal                                                                      | No `valueType: 'literal' \| 'field'` → cross-field comparison (B.3 #4) impossible today                                                                                                                                                                                                                                                 |
| **Field registry** (`FieldDefinition`)                        | `name, type(number\|string\|boolean\|date), description`                                                                      | No `unit, precision, nullable, default_if_missing, source, enum values, list ref`                                                                                                                                                                                                                                                       |
| **FieldSchema type**                                          | `Record<string, FieldType>` (name→type only)                                                                                  | Needs to become `Record<string, FieldMeta>` — ripples everywhere it is built (rules cache, decision-table compile)                                                                                                                                                                                                                      |
| **Trace**                                                     | flat `TraceEntry[]`                                                                                                           | B.5 wants structured `{ type, result, nodes, aggregatesUsed, listsUsed, scoreBreakdown, otherRulesConsidered }`                                                                                                                                                                                                                         |
| **Decision tables**                                           | hit policy `first\|all`; `output` is already an arbitrary object (multi-output data is free); cells `* / >X / a..b / a,b / =` | Missing `best`/`unique` policies, publish-time overlap detection, nested-table refs; multi-output + ranges need UI only                                                                                                                                                                                                                 |
| **Scoring / aggregates / lists / lookups**                    | none                                                                                                                          | all new                                                                                                                                                                                                                                                                                                                                 |
| **No-match**                                                  | tenant setting `treat_as_no_match \| reject_request`                                                                          | fallback catch-all rule (#15) not enforced/nudged                                                                                                                                                                                                                                                                                       |
| **Part A guidance**                                           | StampChip / LedgerTable / TraceReceipt etc. exist                                                                             | no concept strip, glossary, inline helpers, setup checklist, plain-language toggle                                                                                                                                                                                                                                                      |

## Guiding architectural stance

**The pure evaluator in `shared` must stay pure and side-effect-free** — it runs
identically in the browser sandbox and on the server. Therefore anything needing I/O
(aggregates via history queries, managed lists, external lookups) is **pre-resolved by the
API** and injected via `EvaluateOptions` (`lists`, `aggregates`, `lookups`, plus an
`evalContext` carrying `now` / `tenantTimezone` / `fiscalYearStart`). The AST node references a
list/aggregate/lookup by name; the evaluator only reads the injected result. This keeps the
shared package testable and browser-safe, and lets the trace honestly report
`listsUsed` / `aggregatesUsed`.

## Sequenced roadmap

### Milestone 1 — Engine core ✅ DONE

Foundation everything else sits on. Shipped: full B.1 operator catalog + per-type
legality (`operators.ts`), cross-field `valueType`, tz-aware date/time ops
(`datetime.ts`, `EvalContext` from tenant settings), `FieldMeta` registry with migration
`20260709130000_addendum_field_meta` (unit/precision/nullable/default_if_missing/source/
enum_values) surfaced through `getFieldSchema`, structured B.5 `evaluationTrace`
(`{type,result,nodes,aggregatesUsed,listsUsed,scoreBreakdown}`) + `ruleType`, and the
catch-all fallback rule (root empty-AND) with `GET /rules/contexts/health`. Note:
`matchesConsidered` retained as the "other rules considered" ranking (not renamed).
Green: 249 shared unit tests, 98 API e2e, web typecheck + build.

1. AST: add `valueType: 'literal' | 'field'` to comparison nodes (defaults to `literal`, so
   every stored AST stays valid) → unlocks cross-field comparison (B.3 #4).
2. Full operator catalog (B.1), grouped by field type; each operator gets an evaluate case +
   a validation rule for which types it is legal on.
3. `evalContext` (now / tenant timezone / fiscal-year-start) threaded through
   `EvaluateOptions` for all date/time operators. Store/compare UTC; author/display in tenant
   timezone (default `Asia/Kolkata`).
4. Field-registry meta: migration adding `unit, precision, nullable, default_if_missing,
source, enum_values` to `field_definitions`; `FieldSchema` → `FieldMeta` map with a
   back-compat shim; `default_if_missing` handling; currency-as-integer-minor-units
   enforcement; unit-mismatch → trace warning (test scenario 21).
5. Structured trace (B.5) + `otherRulesConsidered` surfaced in the evaluate service.
6. Fallback catch-all rule (B.3 #15): warn when a context has no always-match,
   lowest-priority rule.
7. Exhaustive evaluator unit tests for the whole operator matrix.

### Milestone 2 — Scoring rules (B.3 #3) ✅ DONE

Shipped: `ruleType` discriminator on `rule_versions` (`condition_tree` | `scoring`) with
migration `20260709160000_addendum_scoring_rules` — `condition_ast` is now nullable, a new
`scoring_spec` jsonb holds the spec, and a CHECK constraint keeps the two shapes exclusive
(exactly one payload per type). Pure weighted-score evaluator in
`shared/src/rule-evaluator/scoring.ts`: factors are `{ field, weight, scoringFunction,
missingScore? }` summed and compared with `threshold` via `>=` (default), `>`, `<=` or `<`.
Five scoring functions — `linear` (0..1 normalization, clamped by default), `bands` (ascending
step function, last band must be an open catch-all), `map` (exact lookup + `default`),
`boolean`, and `condition` (scores a nested condition AST, so a factor reaches the whole B.1
operator catalog). Negative weights mitigate. Missing fields score `missingScore` and are noted,
never thrown; `defaultIfMissing` from the M1 field registry applies first. The trace emits one
node per factor plus a threshold root, and `scoreBreakdown {total, threshold, operator,
factors[{field, value, weight, score, contribution, notes}]}`. Specificity for conflict
resolution = factor count (as leaves are for trees), so scoring and condition rules rank in one
list. A scoring rule never counts as a context catch-all. The Rule Builder blocks editing a
scoring rule (it would clobber the spec) until the M3 UI lands; the sandbox receipt renders the
tally. Green: 285 shared unit tests (36 new), 111 API e2e (13 new), lint + typecheck + build.

1. AST/DB: `rule_type` enum, nullable `condition_ast`, `scoring_spec` jsonb, CHECK constraint.
2. `evaluateScoring` + `validateScoringSpec` + `countScoringFactors` in `shared`.
3. Evaluate service dispatches on `ruleType`; `matchesConsidered` entries carry it too.

### Milestone 3 — Decision tables + managed lists + Part A components (Phase 3) ✅ DONE

- Hit policies `best` (most non-wildcard cells wins) + `unique` (publish blocks on overlap);
  pairwise **overlap detection** at publish (test scenario 16); nested-table refs
  (`→ decision_table_ref`, depth cap 3).
- Multi-output columns + range/wildcard formalization in the grid UI; enum cells as
  multi-select.
- **Managed lists** entity (tenant-scoped name + values, editable without republishing a rule)
  - `IN_LIST`/`NOT_IN_LIST` operators + CRUD + cache invalidation (test scenario 19).
- **Part A shared components**: `ConceptStrip`, `FieldHelp` (static helper line beneath
  inputs), `GlossaryDrawer` (`?` in top bar), `SetupChecklist` (sidebar footer),
  `PlainLanguageToggle` (ALL/ANY segmented + live read-only JSON pane), teaching empty states,
  the error-language pass (A.4 — name the offending rule/condition/node, click-to-scroll),
  role-aware guidance depth (A.5), per-user dismissal state (`users.settings` jsonb).
- Rule Builder wiring: operator dropdown filtered by field type, cross-field value picker,
  plain-language ↔ technical toggle, computed/looked-up field badges.

### Milestone 4 — Workflow (Phase 4) ✅ DONE

- ✅ Multi-condition `condition_branch` routing (B.3 #14) as a workflow node concern —
  shared ConditionGroup evaluated against request payload at runtime; visual builder in
  the Workflow Builder edge panel.
- ✅ Consequence previews (A.1 #3):
  - `GET roles/:id/consequences` + `DELETE roles/:id` → 409 while published workflow
    heads route (or escalate) to the role, or steps are pending on it.
  - `GET users/:id/consequences` — roles where the user is the sole active member and
    something would stall.
  - Quorum helper line in the builder (All/Any/N-of-M consequences, including
    "N > members: this step can never complete").

### Milestone 5 — Infra-dependent (Phase 6) ✅ DONE

- ✅ Aggregate/lookback operators (B.3 #5): `AGGREGATE_COUNT_WITHIN` / `AGGREGATE_SUM_WITHIN`,
  `groupBy`, rolling windows, Redis cache w/ short TTL, fiscal-year reset (test scenarios
  17, 22). Evaluator stays pure — aggregates pre-resolved by the API aggregate provider
  over request history and injected via `EvaluateOptions.aggregates`; missing aggregate
  fails closed (`missing_aggregate`).
- ✅ Velocity / rate-limiting rules (B.3 #6) — short-window specialization on the same
  aggregate provider, outcome usually `auto_reject` / `flag_for_review`.
- ✅ External lookups (B.3 #10): `source: looked_up` fields, outbound HTTP with
  `fallback_behavior` (`treat_as_no_match` / `use_cached_value` / `block_and_alert`),
  short-TTL cache, test scenario 20. Field config UI (lookup URL, cache TTL, fallback)
  in the Fields page; aggregate operand editor in the Rule Builder condition builder.

## Test scenarios (master-prompt §10 additions 16–22) mapped to milestones

- 16 (unique-match overlap block) → M3
- 17 (rolling 30-day count, excl. cancelled, Redis TTL < window) → M5
- 18 (`ANY_ITEM_MATCHES` on 1 of 20 items) → M1 (operator) / M3 (UI)
- 19 (managed list edit reflects immediately) → M3
- 20 (external lookup timeout → fallback applied, never silent pass) → M5
- 21 (currency unit mismatch → trace warning, not hard-fail) → M1
- 22 (fiscal-year aggregate resets Apr 1) → M5

## Open decisions — confirmed, and where they landed

1. **Evaluator stays pure; aggregates/lists/lookups pre-resolved by the API and injected** via
   `EvaluateOptions` (the stance above). ✅ Held through M1/M2 — `evaluateScoring` is pure and
   browser-safe; a `condition` factor's nested AST runs on the same injected options.
2. **B.5 trace format is a breaking change** to the sandbox `TraceReceipt` and evaluator
   tests. Migrate both in the same milestone rather than dual-emitting old+new shapes. ✅ M1.
3. **Scoring rules as a new `ruleType` discriminator on the rule version** (vs. a score node
   inside the condition AST). ✅ M2 — enum column + exclusive payload columns, so a scoring
   version carries no vestigial AST and can never be mistaken for a catch-all.
