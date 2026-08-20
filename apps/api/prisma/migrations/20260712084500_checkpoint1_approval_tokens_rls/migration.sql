-- Checkpoint 1: row-level security for approval_tokens (same fail-closed policy
-- as every other tenant-scoped table). The no-login landing page resolves a
-- token via the owner connection (pre-auth, no tenant context), but every other
-- access goes through the approvex_app role — without this policy that role
-- could read/claim tokens across tenants. Principle #1: RLS in addition to app
-- scoping.
ALTER TABLE approval_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_tokens
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
