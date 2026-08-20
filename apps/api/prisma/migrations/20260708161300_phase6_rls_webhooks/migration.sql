-- Phase 6: RLS for webhook/API-key tables + apikey:manage permission.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_endpoints', 'webhook_outbox', 'api_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- New permission for managing machine credentials; existing tenants' system
-- Admin roles pick it up here, new tenants get it via the signup bootstrap
-- (which grants every catalog entry).
INSERT INTO permissions (id, key, description) VALUES
  (gen_random_uuid(), 'apikey:manage', 'Create and revoke API keys');

INSERT INTO role_permissions (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM roles r
JOIN permissions p ON p.key = 'apikey:manage'
WHERE r.is_system = true AND r.name = 'Admin'
ON CONFLICT DO NOTHING;
