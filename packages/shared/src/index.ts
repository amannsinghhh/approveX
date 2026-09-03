/**
 * @approvex/shared — types and pure logic shared across api, worker, and web.
 *
 * The condition-AST rule evaluator lands here in Phase 2 so the API and the
 * sandbox UI evaluate rules with the exact same code.
 */

export * from './rule-evaluator';
export * from './decision-table';
export * from './workflow';
export * from './webhooks';

// NOTE: './approval-tokens' is deliberately NOT re-exported here. It depends on
// node:crypto, and this barrel is bundled by the web app (via Vite). Node-only
// consumers (api, worker) import it through the '@approvex/shared/approval-tokens'
// subpath instead — see approval-tokens.js / approval-tokens.d.ts at the package root.
