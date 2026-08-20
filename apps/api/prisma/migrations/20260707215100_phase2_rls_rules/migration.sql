-- Phase 2: RLS for rule tables + published-version immutability.

------------------------------------------------------------------------------
-- 1. Row-level security (same fail-closed policy as Phase 1 tables).
------------------------------------------------------------------------------
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON field_definitions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

------------------------------------------------------------------------------
-- 2. Published rule versions are immutable for everyone, including the owner.
--    The publish action itself (published_at NULL -> value) is the one
--    permitted transition. Draft versions stay editable and deletable.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rule_versions_block_published_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'published rule versions are immutable: % is not allowed', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER rule_versions_immutable
  BEFORE UPDATE OR DELETE ON rule_versions
  FOR EACH ROW EXECUTE FUNCTION rule_versions_block_published_mutation();
