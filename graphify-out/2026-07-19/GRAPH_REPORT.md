# Graph Report - rule engine  (2026-07-10)

## Corpus Check
- 231 files · ~105,385 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1613 nodes · 3884 edges · 95 communities (86 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8cddc152`
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

## God Nodes (most connected - your core abstractions)
1. `AuthUser` - 102 edges
2. `CurrentUser` - 94 edges
3. `TenantPrismaService` - 47 edges
4. `api()` - 39 edges
5. `useAuth()` - 31 edges
6. `AuditService` - 28 edges
7. `cn()` - 27 edges
8. `RequestEngineService` - 24 edges
9. `PrismaService` - 21 edges
10. `StampChip()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `ConditionRow()` --references--> `NO_VALUE_OPERATORS`  [EXTRACTED]
  apps/web/src/components/condition-builder.tsx → packages/shared/src/rule-evaluator/operators.ts
- `bootstrap()` --indirect_call--> `AppModule`  [INFERRED]
  apps/api/src/main.ts → apps/api/src/app.module.ts
- `createTestApp()` --indirect_call--> `AppModule`  [INFERRED]
  apps/api/test/utils.ts → apps/api/src/app.module.ts
- `FieldMetaInput` --references--> `CreateFieldDto`  [EXTRACTED]
  apps/api/src/fields/fields.service.ts → apps/api/src/fields/fields.schemas.ts
- `FieldMetaWrite` --references--> `CreateFieldDto`  [EXTRACTED]
  apps/api/src/fields/fields.service.ts → apps/api/src/fields/fields.schemas.ts

## Import Cycles
- None detected.

## Communities (95 total, 9 thin omitted)

### Community 0 - "fields.controller.ts"
Cohesion: 0.09
Nodes (24): FieldsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+16 more)

### Community 1 - "roles.controller.ts"
Cohesion: 0.09
Nodes (25): PERMISSION_KEYS, RolesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete (+17 more)

### Community 2 - "main.ts"
Cohesion: 0.10
Nodes (26): createPrisma(), env, createMailer(), Mailer, bootstrap(), JobName, JOBS, log() (+18 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (39): dependencies, @approvex/shared, argon2, ioredis, @nestjs/common, @nestjs/core, @nestjs/jwt, @nestjs/platform-express (+31 more)

### Community 4 - "types.ts"
Cohesion: 0.19
Nodes (15): ValidationIssue, ApprovalNodeConfig, edgeKey(), Quorum, REJECTION_POLICIES, RejectionPolicy, WORKFLOW_NODE_TYPES, WorkflowGraph (+7 more)

### Community 5 - "users.controller.ts"
Cohesion: 0.15
Nodes (13): Module, UsersModule, ListUsersQuery, listUsersQuerySchema, UpdateSettingsDto, updateSettingsSchema, UpdateUserDto, updateUserSchema (+5 more)

### Community 6 - "AppShell.tsx"
Cohesion: 0.17
Nodes (20): Wordmark(), Button, BUTTON_STYLES, ButtonVariant, Card(), Input, Label(), Segmented() (+12 more)

### Community 7 - "index.ts"
Cohesion: 0.10
Nodes (23): evaluateCondition(), ConditionScoring, AggregateUsage, ComparisonOperator, ConditionNode, EvalContext, EvaluateOptions, FIELD_SOURCES (+15 more)

### Community 8 - "rules.controller.ts"
Cohesion: 0.18
Nodes (16): ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get, HttpCode (+8 more)

### Community 9 - "cn"
Cohesion: 0.19
Nodes (17): PageHeader(), EmptyState(), LedgerColumn, LedgerTable(), MonoId(), StampChip(), StampTone, STATUS_TONE (+9 more)

### Community 10 - "scoring.ts"
Cohesion: 0.09
Nodes (29): PathResolution, resolvePath(), BandsScoring, BooleanScoring, compareScore(), countScoringFactors(), evaluateScoring(), FactorOutcome (+21 more)

### Community 11 - "PrismaService"
Cohesion: 0.34
Nodes (9): specTable(), auth(), createRole(), createTestApp(), createUserWithRoles(), SignedUpTenant, signupTenant(), TestUser (+1 more)

### Community 12 - "invitations.service.ts"
Cohesion: 0.10
Nodes (19): InvitationsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+11 more)

### Community 13 - "auth.controller.ts"
Cohesion: 0.21
Nodes (14): AuthController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, HttpCode (+6 more)

### Community 14 - "ZodValidationPipe"
Cohesion: 0.12
Nodes (14): AnalyticsController, ApiBearerAuth, ApiOperation, ApiTags, Controller, Get, Query, AnalyticsModule (+6 more)

### Community 15 - "AuthUser"
Cohesion: 0.18
Nodes (17): CurrentUser, RulesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete (+9 more)

### Community 16 - "main.tsx"
Cohesion: 0.13
Nodes (27): AppShell(), ConceptStrip(), api(), AuthContext, AuthProvider(), AuthState, Me, useAuth() (+19 more)

### Community 17 - "RequestEngineService"
Cohesion: 0.12
Nodes (12): AuditService, Injectable, TenantPrismaService, Injectable, asGraph(), EngineState, InstantiateParams, Tx (+4 more)

### Community 18 - "CurrentUser"
Cohesion: 0.17
Nodes (17): RequestsController, ApiBearerAuth, ApiHeader, ApiKeyScopes, ApiOperation, ApiTags, Body, Controller (+9 more)

### Community 19 - "WorkflowsController"
Cohesion: 0.23
Nodes (14): BindWorkflowDto, bindWorkflowSchema, CreateWorkflowDto, createWorkflowSchema, definitionFields, ListWorkflowsQuery, listWorkflowsQuerySchema, UpdateWorkflowDto (+6 more)

### Community 20 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, @approvex/shared, clsx, lucide-react, react, react-dom, react-router-dom, tailwind-merge (+17 more)

### Community 21 - "DecisionTablesController"
Cohesion: 0.18
Nodes (16): DecisionTablesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+8 more)

### Community 22 - ".forTenant"
Cohesion: 0.22
Nodes (4): redact(), approvalConfig(), RequestEngineService, Injectable

### Community 23 - "TenantPrismaService"
Cohesion: 0.29
Nodes (3): listsKey(), ruleSetKey(), spec()

### Community 24 - "webhooks.controller.ts"
Cohesion: 0.09
Nodes (24): Tx, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+16 more)

### Community 25 - "WebhooksSettingsPage.tsx"
Cohesion: 0.20
Nodes (13): KeyValueList(), ACTION_LABEL, RequestDetail(), Timeline(), SlaMeter(), formatDateTime(), formatINR(), payloadAmount() (+5 more)

### Community 26 - "AnalyticsPage.tsx"
Cohesion: 0.11
Nodes (12): useCountUp(), usePrefersReducedMotion(), ACCENT, AnalyticsPage(), Count(), Donut(), humanHours(), Summary (+4 more)

### Community 27 - "WorkflowBuilderPage.tsx"
Cohesion: 0.09
Nodes (23): DecisionTable, DecisionTableVersion, DryRunResult, InboxItem, PendingApproverData, RequestDetailData, RequestListItem, RequestStepData (+15 more)

### Community 28 - "compile.ts"
Cohesion: 0.13
Nodes (31): CellParseError, compileRowToAst(), parseCell(), parseLiteral(), validateDecisionTable(), evaluateAtDepth(), evaluateDecisionTable(), refOf() (+23 more)

### Community 29 - "evaluate.ts"
Cohesion: 0.14
Nodes (27): formatterCache, formatterFor(), normalizeWeekday(), parseClock(), sameZonedDay(), WEEKDAY_INDEX, zonedParts, coerceOrdered() (+19 more)

### Community 30 - "AuthController"
Cohesion: 0.10
Nodes (21): ManagedListsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+13 more)

### Community 31 - "WebhooksController"
Cohesion: 0.21
Nodes (12): CreateRuleDto, createRuleSchema, ListRulesQuery, listRulesQuerySchema, payloadMatchesTypeMessage, ruleVersionFields, UpdateRuleDto, updateRuleSchema (+4 more)

### Community 32 - "package.json"
Cohesion: 0.09
Nodes (21): description, devDependencies, eslint, @eslint/js, prettier, typescript, typescript-eslint, engines (+13 more)

### Community 33 - "api-keys.controller.ts"
Cohesion: 0.20
Nodes (8): ApiKeysModule, Module, CreateApiKeyDto, createApiKeySchema, ApiKeysService, sha256(), Injectable, API_KEY_SCOPES

### Community 34 - "package.json"
Cohesion: 0.10
Nodes (20): dependencies, @approvex/shared, bullmq, ioredis, @prisma/client, devDependencies, prisma, tsx (+12 more)

### Community 35 - "evaluate.service.ts"
Cohesion: 0.23
Nodes (12): AuthUser, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+4 more)

### Community 37 - "requests.controller.ts"
Cohesion: 0.32
Nodes (10): ApproveStepDto, approveStepSchema, CreateRequestDto, createRequestSchema, DelegateStepDto, delegateStepSchema, ListRequestsQuery, listRequestsQuerySchema (+2 more)

### Community 38 - "workflows.controller.ts"
Cohesion: 0.12
Nodes (9): RateLimitGuard, Injectable, RedisModule, Global, Module, RedisService, Injectable, ManagedListMap (+1 more)

### Community 39 - "types.ts"
Cohesion: 0.18
Nodes (13): DEFINITION_STATUSES, DefinitionStatus, REQUEST_STATUSES, RequestStatus, getCrypto(), NodeCrypto, signWebhookPayload(), verifyWebhookSignature() (+5 more)

### Community 40 - "decision-tables.controller.ts"
Cohesion: 0.26
Nodes (13): CreateDecisionTableDto, createDecisionTableSchema, definitionFields, ListTablesQuery, listTablesQuerySchema, TestDecisionTableDto, testDecisionTableSchema, UpdateDecisionTableDto (+5 more)

### Community 41 - "ApproveX — CLAUDE.md"
Cohesion: 0.12
Nodes (15): ApproveX — CLAUDE.md, Architecture decisions (Phase 1), Architecture decisions (Phase 2), Architecture decisions (Phase 3), Architecture decisions (Phase 4), Architecture decisions (Phase 5), Architecture decisions (Phase 6), Architecture decisions (Phase 7) (+7 more)

### Community 43 - "DelegationsController"
Cohesion: 0.14
Nodes (12): DelegationsController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+4 more)

### Community 44 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, incremental, lib, noFallthroughCasesInSwitch, noImplicitOverride (+6 more)

### Community 45 - ".list"
Cohesion: 0.20
Nodes (8): AuditController, ApiBearerAuth, ApiOperation, ApiTags, Controller, Get, Query, RequirePermissions

### Community 47 - "package.json"
Cohesion: 0.14
Nodes (13): description, devDependencies, typescript, vitest, main, name, private, scripts (+5 more)

### Community 48 - "OnboardingPage.tsx"
Cohesion: 0.22
Nodes (10): Template, TemplateRole, TEMPLATES, BuildLine, DryRunResult, ensureField(), ensureRole(), OnboardingPage() (+2 more)

### Community 49 - "evaluateCondition"
Cohesion: 0.21
Nodes (12): ADMIN_NAV, NAV, NavEntry(), NavItem, Command, CommandPalette(), RequestHit, STATIC_COMMANDS (+4 more)

### Community 50 - "rules.module.ts"
Cohesion: 0.14
Nodes (18): AuthModule, Module, DecisionTablesModule, Module, EvaluateModule, Module, FieldsModule, Module (+10 more)

### Community 51 - "Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine"
Cohesion: 0.17
Nodes (11): Addendum Implementation Plan — Guided UI Layer + Exhaustive Rule Engine, Guiding architectural stance, Milestone 1 — Engine core ✅ DONE, Milestone 2 — Scoring rules (B.3 #3) ✅ DONE, Milestone 3 — Decision tables + managed lists + Part A components (Phase 3), Milestone 4 — Workflow (Phase 4), Milestone 5 — Infra-dependent (Phase 6), Open decisions — confirmed, and where they landed (+3 more)

### Community 52 - "ApproveX"
Cohesion: 0.17
Nodes (12): ApproveX, Dashboard, continued (Phase 5), Dashboard (Phase 3), Development, Getting started, Hardening & launch (Phase 7), Rule engine (Phase 2), Security model (Phase 1) (+4 more)

### Community 53 - "HealthController"
Cohesion: 0.17
Nodes (10): ApiOkResponse, Public(), HealthController, ApiOperation, ApiTags, Controller, Get, Public (+2 more)

### Community 54 - "auth.controller.ts"
Cohesion: 0.18
Nodes (14): AcceptInvitationDto, acceptInvitationSchema, LoginDto, loginSchema, RefreshDto, refreshSchema, SignupDto, signupSchema (+6 more)

### Community 55 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution, outDir, strictPropertyInitialization (+2 more)

### Community 56 - "condition-builder.tsx"
Cohesion: 0.20
Nodes (12): ArrayInput(), Comparison, ConditionGroup(), ConditionRow(), defaultValueForOperator(), emptyComparison(), emptyGroup(), FieldDef (+4 more)

### Community 57 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, jsx, lib, module, moduleResolution, noEmit, sourceMap (+2 more)

### Community 58 - "regex.ts"
Cohesion: 0.10
Nodes (28): ARRAY, BOOLEAN, DATE, DAY_NAMES, isOperatorLegalForType(), NO_VALUE_OPERATORS, NUMERIC, OPERAND_SHAPE (+20 more)

### Community 59 - ".create"
Cohesion: 0.16
Nodes (11): ApiKeysController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, HttpCode (+3 more)

### Community 60 - "EvaluateService"
Cohesion: 0.27
Nodes (15): Bound, cmp(), columnDisjoint(), eqVal(), excludeDisjoint(), inInterval(), intervalsDisjoint(), MaybeBound (+7 more)

### Community 61 - "app.module.ts"
Cohesion: 0.50
Nodes (3): AppModule, Module, bootstrap()

### Community 62 - "How ApproveX works"
Cohesion: 0.22
Nodes (9): Background jobs (apps/worker), How ApproveX works, Idempotency, exactly, Immutability and audit, Performance, Tenancy: two connections, RLS always on, The pieces, The request lifecycle, end to end (+1 more)

### Community 63 - "ApproveX — product guide"
Cohesion: 0.22
Nodes (9): ApproveX — product guide, Feature inventory (complete, Phase 0–7), Objection handling, The 90-second demo (this order, every time), The one-liner, The problem (say it in the customer's words), What's deliberately not here (MVP honesty), Who to sell to (+1 more)

### Community 64 - "Integrating with ApproveX"
Cohesion: 0.25
Nodes (7): 1. Get a credential, 2. Ask before you act, 3. Hear the decision — webhooks, 4. Acting on requests programmatically, 5. Limits and errors, 6. Sandbox-first workflow, Integrating with ApproveX

### Community 65 - "Production deployment"
Cohesion: 0.25
Nodes (8): 1. Point DNS, 2. Prepare the server, 3. Launch, 4. Backups, 5. Upgrades, 6. Operations cheat-sheet, Production deployment, Scaling notes (when you outgrow one box)

### Community 66 - "Local development setup"
Cohesion: 0.25
Nodes (8): Everyday commands, Gotchas worth knowing, Load test (Phase 7 target: p95 < 50ms over 1k rules), Local development setup, Path A — everything in Docker, Path B — native (fastest feedback), Prerequisites, Tests

### Community 67 - "compilerOptions"
Cohesion: 0.25
Nodes (7): compilerOptions, module, moduleResolution, outDir, rootDir, extends, include

### Community 68 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 69 - "audit.interceptor.ts"
Cohesion: 0.20
Nodes (9): querySchema, AuditQuery, auditQuerySchema, ApiKeyScope, PermissionKey, RequirePermissions(), Injectable, ZodValidationPipe (+1 more)

### Community 70 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, outDir, extends, include

### Community 71 - "testDbUrls"
Cohesion: 0.53
Nodes (3): testDbUrls(), globalSetup(), { owner, app }

### Community 72 - "tsconfig.build.json"
Cohesion: 0.33
Nodes (5): compilerOptions, rootDir, exclude, extends, include

### Community 73 - "OidcService"
Cohesion: 0.29
Nodes (3): base64UrlToBuffer(), OidcService, Injectable

### Community 74 - "AuthService"
Cohesion: 0.20
Nodes (11): ApiKeyScopes(), RateLimited(), evaluateSchema, DryRunResponse, EvaluatedRule, ExecuteResponse, MatchOutcome, MatchSummary (+3 more)

### Community 75 - "oidc.service.ts"
Cohesion: 0.15
Nodes (9): IdTokenClaims, Jwk, OidcProviderId, ProviderConfig, StatePayload, env, AccessTokenPayload, JwtAuthGuard (+1 more)

### Community 77 - "tsconfig.build.json"
Cohesion: 0.40
Nodes (4): compilerOptions, rootDir, extends, include

### Community 79 - "What it costs to run"
Cohesion: 0.40
Nodes (5): Rules of thumb, Stage 1 — Single VPS (everything on one box) · **~₹1,000–2,500 / month**, Stage 2 — Managed data (first paying customers) · **~₹8,000–14,000 / month**, Stage 3 — Scale-out (many tenants, HA) · **~₹30,000+ / month**, What it costs to run

### Community 81 - "ZodValidationPipe"
Cohesion: 0.13
Nodes (13): EvaluateController, ApiBearerAuth, ApiHeader, ApiKeyScopes, ApiOperation, ApiTags, Body, Controller (+5 more)

### Community 82 - "PrismaModule"
Cohesion: 0.67
Nodes (3): PrismaModule, Global, Module

### Community 90 - "JwtAuthGuard"
Cohesion: 0.49
Nodes (3): EvaluateDto, EvaluateService, Injectable

### Community 91 - "AuditModule"
Cohesion: 0.50
Nodes (3): AuditModule, Global, Module

### Community 92 - "AuthModule"
Cohesion: 0.22
Nodes (4): AuditEntry, PrismaService, Injectable, TenantClient

### Community 94 - "audit.interceptor.ts"
Cohesion: 0.33
Nodes (4): AuditInterceptor, MUTATING_METHODS, Injectable, VERB_BY_METHOD

## Knowledge Gaps
- **378 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `tsConfigPath`, `deleteOutDir` (+373 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `spec()` connect `TenantPrismaService` to `scoring.ts`?**
  _High betweenness centrality (0.162) - this node is a cross-community bridge._
- **Why does `TenantPrismaService` connect `RequestEngineService` to `fields.controller.ts`, `roles.controller.ts`, `users.controller.ts`, `PrismaService`, `invitations.service.ts`, `ZodValidationPipe`, `WorkflowsController`, `.forTenant`, `webhooks.controller.ts`, `AuthController`, `WebhooksController`, `api-keys.controller.ts`, `requests.controller.ts`, `workflows.controller.ts`, `decision-tables.controller.ts`, `DelegationsController`, `.list`, `DecisionTablesService`, `auth.controller.ts`, `audit.interceptor.ts`, `AuthService`, `PermissionsGuard`, `AuthModule`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `AuthUser` connect `evaluate.service.ts` to `fields.controller.ts`, `roles.controller.ts`, `users.controller.ts`, `rules.controller.ts`, `invitations.service.ts`, `auth.controller.ts`, `ZodValidationPipe`, `AuthUser`, `CurrentUser`, `WorkflowsController`, `DecisionTablesController`, `.forTenant`, `webhooks.controller.ts`, `AuthController`, `WebhooksController`, `api-keys.controller.ts`, `requests.controller.ts`, `decision-tables.controller.ts`, `DelegationsController`, `.list`, `auth.controller.ts`, `.create`, `audit.interceptor.ts`, `AuthService`, `oidc.service.ts`, `ZodValidationPipe`, `audit.interceptor.ts`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _379 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fields.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09388335704125178 - nodes in this community are weakly interconnected._
- **Should `roles.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08780487804878048 - nodes in this community are weakly interconnected._
- **Should `main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10365853658536585 - nodes in this community are weakly interconnected._