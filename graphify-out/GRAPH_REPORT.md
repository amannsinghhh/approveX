# Graph Report - approvex  (2026-07-19)

## Corpus Check
- 279 files · ~147,928 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1992 nodes · 4816 edges · 102 communities (95 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `18050a61`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- fields.controller.ts
- roles.controller.ts
- main.ts
- dependencies
- types.ts
- users.controller.ts
- AppShell.tsx
- index.ts
- rules.controller.ts
- cn
- scoring.ts
- PrismaService
- invitations.service.ts
- auth.controller.ts
- ZodValidationPipe
- AuthUser
- main.tsx
- RequestEngineService
- CurrentUser
- WorkflowsController
- dependencies
- DecisionTablesController
- .forTenant
- TenantPrismaService
- webhooks.controller.ts
- WebhooksSettingsPage.tsx
- AnalyticsPage.tsx
- WorkflowBuilderPage.tsx
- compile.ts
- evaluate.ts
- AuthController
- WebhooksController
- package.json
- api-keys.controller.ts
- package.json
- evaluate.service.ts
- OidcService
- requests.controller.ts
- workflows.controller.ts
- types.ts
- decision-tables.controller.ts
- ApproveX — CLAUDE.md
- .evaluate
- DelegationsController
- compilerOptions
- .list
- DecisionTablesService
- package.json
- OnboardingPage.tsx
- evaluateCondition
- rules.module.ts
- Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine
- ApproveX
- HealthController
- auth.controller.ts
- compilerOptions
- condition-builder.tsx
- compilerOptions
- regex.ts
- .create
- EvaluateService
- app.module.ts
- How ApproveX works
- ApproveX — product guide
- Integrating with ApproveX
- Production deployment
- Local development setup
- compilerOptions
- nest-cli.json
- audit.interceptor.ts
- compilerOptions
- testDbUrls
- tsconfig.build.json
- OidcService
- AuthService
- oidc.service.ts
- testDbUrl
- tsconfig.build.json
- README.md
- What it costs to run
- PermissionsGuard
- ZodValidationPipe
- PrismaModule
- k6-evaluate.js
- eslint.config.mjs
- backup.sh
- JwtAuthGuard
- AuditModule
- AuthModule
- WorkflowsModule
- audit.interceptor.ts
- tsconfig.build.json
- tsconfig.build.json
- index.ts
- backup.sh

## God Nodes (most connected - your core abstractions)
1. `AuthUser` - 110 edges
2. `CurrentUser` - 101 edges
3. `TenantPrismaService` - 53 edges
4. `api()` - 51 edges
5. `cn()` - 51 edges
6. `useAuth()` - 38 edges
7. `AuditService` - 30 edges
8. `RequestEngineService` - 26 edges
9. `Button` - 26 edges
10. `evaluateComparison()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `validateScoringSpec()` --indirect_call--> `field()`  [INFERRED]
  packages/shared/src/rule-evaluator/scoring.ts → apps/web/test/local-eval.spec.ts
- `validateConditionAst()` --indirect_call--> `field()`  [INFERRED]
  packages/shared/src/rule-evaluator/validate.ts → apps/web/test/local-eval.spec.ts
- `evaluateScoring()` --indirect_call--> `notes()`  [INFERRED]
  packages/shared/src/rule-evaluator/scoring.ts → apps/web/test/local-eval.spec.ts
- `operatorLabel()` --references--> `ComparisonOperator`  [EXTRACTED]
  apps/web/src/components/condition-builder.tsx → packages/shared/src/rule-evaluator/types.ts
- `bootstrap()` --indirect_call--> `AppModule`  [INFERRED]
  apps/api/src/main.ts → apps/api/src/app.module.ts

## Import Cycles
- None detected.

## Communities (102 total, 7 thin omitted)

### Community 0 - "fields.controller.ts"
Cohesion: 0.10
Nodes (24): FieldsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+16 more)

### Community 1 - "roles.controller.ts"
Cohesion: 0.14
Nodes (15): RolesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+7 more)

### Community 2 - "main.ts"
Cohesion: 0.10
Nodes (27): createPrisma(), env, createMailer(), Mailer, bootstrap(), JobName, JOBS, log() (+19 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (42): dependencies, @approvex/shared, argon2, ioredis, @nestjs/common, @nestjs/core, @nestjs/jwt, @nestjs/platform-express (+34 more)

### Community 4 - "types.ts"
Cohesion: 0.09
Nodes (29): DEFINITION_STATUSES, DefinitionStatus, NOTE: './approval-tokens' is deliberately NOT re-exported here. It depends on, REQUEST_STATUSES, RequestStatus, getCrypto(), NodeCrypto, signWebhookPayload() (+21 more)

### Community 5 - "users.controller.ts"
Cohesion: 0.12
Nodes (17): PUBLISHED_HEAD_SELECT, PublishedHeadRow, WorkflowRoleRef, workflowsReferencingRole(), Module, UsersModule, ListUsersQuery, listUsersQuerySchema (+9 more)

### Community 6 - "AppShell.tsx"
Cohesion: 0.13
Nodes (25): Wordmark(), Button, BUTTON_STYLES, ButtonVariant, Card(), Input, Label(), Segmented() (+17 more)

### Community 7 - "index.ts"
Cohesion: 0.12
Nodes (16): evaluateCondition(), operatorsForType(), FactorOutcome, ComparisonOperator, ConditionNode, EvaluateOptions, TraceNote, catchAllAst() (+8 more)

### Community 8 - "rules.controller.ts"
Cohesion: 0.18
Nodes (16): ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get, HttpCode (+8 more)

### Community 9 - "cn"
Cohesion: 0.10
Nodes (37): PageHeader(), operatorLabel(), EmptyState(), LedgerColumn, LedgerTable(), MonoId(), ACTION_LABEL, RequestDetail() (+29 more)

### Community 10 - "scoring.ts"
Cohesion: 0.11
Nodes (31): notes(), collectLookupFields(), visit(), PathResolution, resolvePath(), BandsScoring, BooleanScoring, compareScore() (+23 more)

### Community 11 - "PrismaService"
Cohesion: 0.17
Nodes (16): AppModule, Module, JwtAuthGuard, Injectable, bootstrap(), PrismaService, Injectable, specTable() (+8 more)

### Community 12 - "invitations.service.ts"
Cohesion: 0.15
Nodes (12): InvitationsController, ApiBearerAuth, ApiTags, Body, Controller, Post, RequirePermissions, CreateInvitationDto (+4 more)

### Community 13 - "auth.controller.ts"
Cohesion: 0.22
Nodes (14): AuthController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, HttpCode (+6 more)

### Community 14 - "ZodValidationPipe"
Cohesion: 0.12
Nodes (14): AnalyticsController, ApiBearerAuth, ApiOperation, ApiTags, Controller, Get, Query, AnalyticsModule (+6 more)

### Community 15 - "AuthUser"
Cohesion: 0.17
Nodes (16): RulesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+8 more)

### Community 16 - "main.tsx"
Cohesion: 0.12
Nodes (22): AppShell(), ConceptStrip(), PORTAL_NAV, PortalLayout(), ChecklistItem, SetupChecklist(), AuthContext, AuthProvider() (+14 more)

### Community 17 - "RequestEngineService"
Cohesion: 0.11
Nodes (12): AuditService, Injectable, Definition, VERSION_SELECT, TenantPrismaService, Injectable, ROLE_SELECT, RoleRow (+4 more)

### Community 18 - "CurrentUser"
Cohesion: 0.18
Nodes (17): RequestsController, ApiBearerAuth, ApiHeader, ApiKeyScopes, ApiOperation, ApiTags, Body, Controller (+9 more)

### Community 19 - "WorkflowsController"
Cohesion: 0.19
Nodes (16): Module, WorkflowsModule, BindWorkflowDto, bindWorkflowSchema, CreateWorkflowDto, createWorkflowSchema, definitionFields, ListWorkflowsQuery (+8 more)

### Community 20 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, @approvex/shared, clsx, lucide-react, react, react-dom, react-router-dom, recharts (+23 more)

### Community 21 - "DecisionTablesController"
Cohesion: 0.08
Nodes (30): DecisionTablesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+22 more)

### Community 22 - ".forTenant"
Cohesion: 0.21
Nodes (5): redact(), approvalConfig(), asGraph(), RequestEngineService, Injectable

### Community 23 - "TenantPrismaService"
Cohesion: 0.09
Nodes (25): PortalController, ApiBearerAuth, ApiHeader, ApiOperation, ApiTags, Body, Controller, Get (+17 more)

### Community 24 - "webhooks.controller.ts"
Cohesion: 0.09
Nodes (23): ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get, HttpCode (+15 more)

### Community 25 - "WebhooksSettingsPage.tsx"
Cohesion: 0.07
Nodes (39): KeyValueList(), Timeline(), StampTone, Tabs(), api(), formatDateTime(), formatINR(), timeAgo() (+31 more)

### Community 26 - "AnalyticsPage.tsx"
Cohesion: 0.15
Nodes (7): useCountUp(), usePrefersReducedMotion(), Count(), FEATURES, LandingPage(), Stat(), STEPS

### Community 27 - "WorkflowBuilderPage.tsx"
Cohesion: 0.12
Nodes (22): IssueList(), bracketIndices(), hintFor(), HINTS, humanizeConditionIssue(), HumanizedIssue, humanizeTableIssue(), scrollToIssue() (+14 more)

### Community 28 - "compile.ts"
Cohesion: 0.13
Nodes (30): CellParseError, compileRowToAst(), parseCell(), parseLiteral(), validateDecisionTable(), evaluateAtDepth(), evaluateDecisionTable(), refOf() (+22 more)

### Community 29 - "evaluate.ts"
Cohesion: 0.15
Nodes (27): aggregateKey(), isAggregateOperator(), parseAggregateOperand(), walk(), windowLabel(), formatterCache, formatterFor(), normalizeWeekday() (+19 more)

### Community 30 - "AuthController"
Cohesion: 0.10
Nodes (23): ManagedListsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+15 more)

### Community 31 - "WebhooksController"
Cohesion: 0.21
Nodes (12): CreateRuleDto, createRuleSchema, ListRulesQuery, listRulesQuerySchema, payloadMatchesTypeMessage, ruleVersionFields, UpdateRuleDto, updateRuleSchema (+4 more)

### Community 32 - "package.json"
Cohesion: 0.08
Nodes (24): description, devDependencies, eslint, @eslint/js, ffmpeg-static, @playwright/test, prettier, typescript (+16 more)

### Community 33 - "api-keys.controller.ts"
Cohesion: 0.15
Nodes (13): ApiKeysController, ApiBearerAuth, ApiTags, Controller, RequirePermissions, ApiKeysModule, Module, CreateApiKeyDto (+5 more)

### Community 34 - "package.json"
Cohesion: 0.08
Nodes (23): dependencies, @approvex/shared, bullmq, ioredis, @prisma/client, devDependencies, prisma, tsx (+15 more)

### Community 35 - "evaluate.service.ts"
Cohesion: 0.22
Nodes (12): AuthUser, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+4 more)

### Community 36 - "OidcService"
Cohesion: 0.15
Nodes (5): RolesService, shape(), Injectable, Injectable, WorkflowsService

### Community 37 - "requests.controller.ts"
Cohesion: 0.12
Nodes (20): TenantClient, EngineState, InstantiateParams, Tx, ApproveStepDto, approveStepSchema, createDelegationSchema, CreateRequestDto (+12 more)

### Community 38 - "workflows.controller.ts"
Cohesion: 0.10
Nodes (13): cacheKey(), LookupProviderService, Injectable, RedisModule, Global, Module, RedisService, Injectable (+5 more)

### Community 39 - "types.ts"
Cohesion: 0.05
Nodes (37): 0. What we're building and why, 1. Non-negotiable principles (these override everything below), APPROVEX — SINGLE EXECUTION BRIEF, CHECKPOINT 1 — Signed approval tokens (the security foundation), CHECKPOINT 2 — Email approvals, CHECKPOINT 3 — Start the Tally spike (do this NOW, in parallel), CHECKPOINT 4 — WhatsApp approvals, CHECKPOINT 5 — Tally Bridge (+29 more)

### Community 40 - "decision-tables.controller.ts"
Cohesion: 0.07
Nodes (27): A couple of "gotchas" the project warns about, A simple diagram for your slides, Absolute-cheapest option for a quick demo, ApproveX — The Complete Plain-English Guide, Part 1 — What is ApproveX, in plain words?, Part 2 — How it works (explained like you're 12), Part 3 — How to demo it in 90 seconds, Part 4 — Run it on your own laptop (+19 more)

### Community 41 - "ApproveX — CLAUDE.md"
Cohesion: 0.08
Nodes (24): AggregateComparison, AggregateUsage, COMPARISON_OPERATORS, ComparisonNode, EvaluationResult, FIELD_INPUT_TYPES, FIELD_SOURCES, FIELD_TYPES (+16 more)

### Community 42 - ".evaluate"
Cohesion: 0.16
Nodes (18): aggregateOperandIssues(), AggregateOperator, AggregateRef, collectAggregateRefs(), windowStartMs(), zonedMidnightUtc(), zonedParts, OPERAND_SHAPE (+10 more)

### Community 43 - "DelegationsController"
Cohesion: 0.14
Nodes (12): DelegationsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+4 more)

### Community 44 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ApproveX — CLAUDE.md, Architecture decisions (Phase 1), Architecture decisions (Phase 2), Architecture decisions (Phase 3), Architecture decisions (Phase 4), Architecture decisions (Phase 5), Architecture decisions (Phase 6), Architecture decisions (Phase 7) (+7 more)

### Community 45 - ".list"
Cohesion: 0.22
Nodes (7): AuditController, ApiBearerAuth, ApiTags, Controller, AuditModule, Global, Module

### Community 47 - "package.json"
Cohesion: 0.13
Nodes (14): description, devDependencies, @types/node, typescript, vitest, main, name, private (+6 more)

### Community 48 - "OnboardingPage.tsx"
Cohesion: 0.22
Nodes (10): Template, TemplateRole, TEMPLATES, BuildLine, DryRunResult, ensureField(), ensureRole(), OnboardingPage() (+2 more)

### Community 49 - "evaluateCondition"
Cohesion: 0.08
Nodes (32): ADMIN_NAV, NAV, NavEntry(), NavItem, Command, CommandPalette(), RequestHit, STATIC_COMMANDS (+24 more)

### Community 50 - "rules.module.ts"
Cohesion: 0.11
Nodes (21): ApprovalTokensModule, Module, DecisionTablesModule, Module, EvaluateModule, Module, FieldsModule, Module (+13 more)

### Community 51 - "Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine"
Cohesion: 0.17
Nodes (11): Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine, Guiding architectural stance, Milestone 1 — Engine core ✅ DONE, Milestone 2 — Scoring rules (B.3 #3) ✅ DONE, Milestone 3 — Decision tables + managed lists + Part A components (Phase 3) ✅ DONE, Milestone 4 — Workflow (Phase 4) ✅ DONE, Milestone 5 — Infra-dependent (Phase 6) ✅ DONE, Open decisions — confirmed, and where they landed (+3 more)

### Community 52 - "ApproveX"
Cohesion: 0.09
Nodes (21): 1. Get a credential, 2. Ask before you act, 3. Hear the decision — webhooks, 4. Acting on requests programmatically, 5. Managed lists, 6. Limits and errors, 7. Sandbox-first workflow, Integrating with ApproveX (+13 more)

### Community 53 - "HealthController"
Cohesion: 0.20
Nodes (8): ApiOkResponse, Public(), HealthController, ApiOperation, ApiTags, Controller, Get, Public

### Community 54 - "auth.controller.ts"
Cohesion: 0.28
Nodes (10): AcceptInvitationDto, acceptInvitationSchema, LoginDto, loginSchema, refreshSchema, SignupDto, signupSchema, RefreshTokenPayload (+2 more)

### Community 55 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, incremental, lib, noFallthroughCasesInSwitch, noImplicitOverride (+6 more)

### Community 56 - "condition-builder.tsx"
Cohesion: 0.08
Nodes (28): ArrayInput(), Comparison, ConditionGroup(), ConditionRow(), defaultValueForOperator(), DEPTH_ACCENTS, emptyComparison(), emptyGroup() (+20 more)

### Community 57 - "compilerOptions"
Cohesion: 0.14
Nodes (13): 1. Point DNS, 2. Prepare the server, 3. Launch, 4. Backups, 5. Upgrades, 6. Operations cheat-sheet, Production deployment, Rules of thumb (+5 more)

### Community 58 - "regex.ts"
Cohesion: 0.17
Nodes (12): AGGREGATE, ARRAY, BOOLEAN, DATE, DAY_NAMES, isOperatorLegalForType(), NUMERIC, OperandShape (+4 more)

### Community 59 - ".create"
Cohesion: 0.10
Nodes (16): ApiOperation, Body, Get, HttpCode, Param, Post, ApiOperation, Get (+8 more)

### Community 60 - "EvaluateService"
Cohesion: 0.25
Nodes (16): Bound, cmp(), columnDisjoint(), eqVal(), excludeDisjoint(), inInterval(), intervalsDisjoint(), MaybeBound (+8 more)

### Community 61 - "app.module.ts"
Cohesion: 0.18
Nodes (10): ApprovalTokensController, Body, Controller, Get, Headers, HttpCode, Ip, Param (+2 more)

### Community 62 - "How ApproveX works"
Cohesion: 0.38
Nodes (3): ApprovalTokensService, sha256(), Injectable

### Community 63 - "ApproveX — product guide"
Cohesion: 0.35
Nodes (4): RefreshDto, AuthService, sha256(), Injectable

### Community 64 - "Integrating with ApproveX"
Cohesion: 0.31
Nodes (6): getWorker(), isPatternSafe(), RegexTestResult, RegexWorker, safeRegexTest(), WorkerThreadsModule

### Community 65 - "Production deployment"
Cohesion: 0.18
Nodes (10): compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution, outDir, strictPropertyInitialization (+2 more)

### Community 66 - "Local development setup"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, jsx, lib, module, moduleResolution, noEmit, sourceMap (+2 more)

### Community 67 - "compilerOptions"
Cohesion: 0.24
Nodes (5): ApiKeyScopes(), RateLimited(), RateLimitGuard, Injectable, evaluateSchema

### Community 68 - "nest-cli.json"
Cohesion: 0.22
Nodes (7): ActivityEvent, AnalyticsPage(), AXIS_TICK, humanHours(), LEGEND_STYLE, Summary, TOOLTIP_STYLE

### Community 69 - "audit.interceptor.ts"
Cohesion: 0.16
Nodes (13): querySchema, ConsumeTokenDto, consumeTokenSchema, AuditQuery, auditQuerySchema, ApiKeyScope, PERMISSION_KEYS, PermissionKey (+5 more)

### Community 70 - "compilerOptions"
Cohesion: 0.20
Nodes (9): Background jobs (apps/worker), How ApproveX works, Idempotency, exactly, Immutability and audit, Performance, Tenancy: two connections, RLS always on, The pieces, The request lifecycle, end to end (+1 more)

### Community 71 - "testDbUrls"
Cohesion: 0.53
Nodes (3): testDbUrls(), globalSetup(), { owner, app }

### Community 72 - "tsconfig.build.json"
Cohesion: 0.20
Nodes (9): ApproveX — product guide, Feature inventory (complete, Phase 0–7), Objection handling, The 90-second demo (this order, every time), The one-liner, The problem (say it in the customer's words), What's deliberately not here (MVP honesty), Who to sell to (+1 more)

### Community 73 - "OidcService"
Cohesion: 0.29
Nodes (3): base64UrlToBuffer(), OidcService, Injectable

### Community 74 - "AuthService"
Cohesion: 0.18
Nodes (12): AggregateProviderService, cacheKey(), jsonPath(), Injectable, DryRunResponse, EvaluatedRule, ExecuteResponse, MatchOutcome (+4 more)

### Community 75 - "oidc.service.ts"
Cohesion: 0.22
Nodes (7): IdTokenClaims, Jwk, OidcProviderId, ProviderConfig, StatePayload, env, AccessTokenPayload

### Community 77 - "tsconfig.build.json"
Cohesion: 0.22
Nodes (8): Everyday commands, Gotchas worth knowing, Load test (Phase 7 target: p95 < 50ms over 1k rules), Local development setup, Path A — everything in Docker, Path B — native (fastest feedback), Prerequisites, Tests

### Community 78 - "README.md"
Cohesion: 0.25
Nodes (7): compilerOptions, module, moduleResolution, outDir, rootDir, extends, include

### Community 79 - "What it costs to run"
Cohesion: 0.29
Nodes (6): How to get Claude to explain ApproveX to you (super simple), Step 1 — Open Claude, Step 2 — Copy the message below, Step 3 — Paste it and press send, That's it, 👇 The message to copy

### Community 81 - "ZodValidationPipe"
Cohesion: 0.13
Nodes (16): EvaluateController, ApiBearerAuth, ApiHeader, ApiKeyScopes, ApiOperation, ApiTags, Body, Controller (+8 more)

### Community 82 - "PrismaModule"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 86 - "backup.sh"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, outDir, extends, include

### Community 90 - "JwtAuthGuard"
Cohesion: 0.40
Nodes (4): AuthModule, Module, InvitationsModule, Module

### Community 91 - "AuditModule"
Cohesion: 0.60
Nodes (5): fmt(), NodeView(), pair(), phrase(), PlainLanguageToggle()

### Community 92 - "AuthModule"
Cohesion: 0.33
Nodes (4): mp4, resultsDir, root, webm

### Community 93 - "WorkflowsModule"
Cohesion: 0.40
Nodes (3): APPROVER, OWNER, SAMPLE_PAYLOAD

### Community 94 - "audit.interceptor.ts"
Cohesion: 0.12
Nodes (13): ApprovalTokenOutcome, ApprovalTokenView, AttemptMeta, ipMaxAttempts(), IssueTokenParams, LandingDetail, NoLoginAction, tokenMaxAttempts() (+5 more)

### Community 95 - "tsconfig.build.json"
Cohesion: 0.33
Nodes (5): compilerOptions, rootDir, exclude, extends, include

### Community 96 - "tsconfig.build.json"
Cohesion: 0.40
Nodes (4): compilerOptions, rootDir, extends, include

## Knowledge Gaps
- **506 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `tsConfigPath`, `deleteOutDir` (+501 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AuthUser` connect `evaluate.service.ts` to `fields.controller.ts`, `roles.controller.ts`, `users.controller.ts`, `rules.controller.ts`, `PrismaService`, `invitations.service.ts`, `auth.controller.ts`, `ZodValidationPipe`, `AuthUser`, `CurrentUser`, `WorkflowsController`, `DecisionTablesController`, `.forTenant`, `TenantPrismaService`, `webhooks.controller.ts`, `AuthController`, `WebhooksController`, `api-keys.controller.ts`, `requests.controller.ts`, `DelegationsController`, `auth.controller.ts`, `.create`, `compilerOptions`, `audit.interceptor.ts`, `oidc.service.ts`, `ZodValidationPipe`, `audit.interceptor.ts`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `field()` connect `WorkflowBuilderPage.tsx` to `workflows.controller.ts`, `scoring.ts`, `.evaluate`, `OnboardingPage.tsx`, `ZodValidationPipe`, `TenantPrismaService`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `CurrentUser` connect `.create` to `fields.controller.ts`, `roles.controller.ts`, `users.controller.ts`, `rules.controller.ts`, `invitations.service.ts`, `auth.controller.ts`, `ZodValidationPipe`, `AuthUser`, `CurrentUser`, `WorkflowsController`, `DecisionTablesController`, `TenantPrismaService`, `webhooks.controller.ts`, `AuthController`, `WebhooksController`, `api-keys.controller.ts`, `evaluate.service.ts`, `requests.controller.ts`, `DelegationsController`, `auth.controller.ts`, `compilerOptions`, `audit.interceptor.ts`, `ZodValidationPipe`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _508 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fields.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09672830725462304 - nodes in this community are weakly interconnected._
- **Should `roles.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Should `main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10338164251207729 - nodes in this community are weakly interconnected._