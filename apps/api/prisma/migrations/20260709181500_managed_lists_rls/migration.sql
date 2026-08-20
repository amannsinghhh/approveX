-- Addendum M3: row-level security for managed_lists (same fail-closed policy as
-- every other tenant-scoped table). Without this the non-owner approvex_app role
-- would see lists across tenants — principle #1 (RLS in addition to app scoping).
ALTER TABLE managed_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON managed_lists
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
