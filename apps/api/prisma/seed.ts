/**
 * Seed skeleton (Phase 0).
 *
 * Phase 1+: demo tenant, roles (Manager / Finance Head / CFO), users, and the
 * ten starter templates (payment approval 3-tier, leave approval, ...).
 */
async function main(): Promise<void> {
  console.log('[seed] Nothing to seed yet — domain tables arrive in Phase 1.');
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
