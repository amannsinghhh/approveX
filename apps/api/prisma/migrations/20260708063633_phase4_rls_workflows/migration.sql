-- Phase 4: RLS for workflow/request tables + workflow version immutability.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflows', 'workflow_versions', 'rule_workflow_bindings',
    'requests', 'request_steps', 'step_actions', 'delegations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Published workflow versions are immutable, same contract as rule_versions.
CREATE TRIGGER workflow_versions_immutable
  BEFORE UPDATE OR DELETE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION rule_versions_block_published_mutation();
