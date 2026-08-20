-- Phase 3: RLS + published-version immutability for decision tables.

ALTER TABLE decision_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_tables
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE decision_table_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_table_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Reuses the trigger function from the phase2 migration: any UPDATE/DELETE on
-- a row with published_at set raises an exception, even for the table owner.
CREATE TRIGGER decision_table_versions_immutable
  BEFORE UPDATE OR DELETE ON decision_table_versions
  FOR EACH ROW EXECUTE FUNCTION rule_versions_block_published_mutation();
