/**
 * @approvex/shared — types and pure logic shared across api, worker, and web.
 *
 * The condition-AST rule evaluator lands here in Phase 2 so the API and the
 * sandbox UI evaluate rules with the exact same code.
 */

export const SHARED_PACKAGE_NAME = '@approvex/shared';

/** Request lifecycle statuses (section 4 of the spec). */
export const REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Rule/workflow definition statuses. Published versions are immutable. */
export const DEFINITION_STATUSES = ['draft', 'published', 'archived'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export * from './rule-evaluator';
export * from './decision-table';
export * from './workflow';
export * from './webhooks';

// NOTE: './approval-tokens' is deliberately NOT re-exported here. It depends on
// node:crypto, and this barrel is bundled by the web app (via Vite). Node-only
// consumers (api, worker) import it through the '@approvex/shared/approval-tokens'
// subpath instead — see approval-tokens.js / approval-tokens.d.ts at the package root.
