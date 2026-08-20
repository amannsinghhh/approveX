-- Phase 1: row-level security, the app role, the permission catalog, and
-- audit_events immutability. Hand-written — Prisma's datamodel cannot express
-- roles, grants, policies, or triggers (prisma migrate diff ignores them).

------------------------------------------------------------------------------
-- 1. Application role. The API's tenant-scoped connection (APP_DATABASE_URL)
--    logs in as approvex_app, which does NOT own the tables, so RLS applies.
--    Dev password; production must override with ALTER ROLE ... PASSWORD.
------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'approvex_app') THEN
    CREATE ROLE approvex_app LOGIN PASSWORD 'approvex_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO approvex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO approvex_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO approvex_app;

-- The permission catalog is read-only for the app; audit_events is append-only
-- (the trigger below also blocks the owner).
REVOKE INSERT, UPDATE, DELETE ON permissions FROM approvex_app;
REVOKE UPDATE, DELETE ON audit_events FROM approvex_app;
-- Prisma's migration bookkeeping is none of the app's business.
-- (Guarded: the table does not exist in Prisma's shadow database.)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
    REVOKE ALL ON _prisma_migrations FROM approvex_app;
  END IF;
END $$;

------------------------------------------------------------------------------
-- 2. Tenant context helper. Returns NULL when app.tenant_id is unset or empty,
--    which makes every policy below evaluate false — fail closed.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid
$$ LANGUAGE sql STABLE;

------------------------------------------------------------------------------
-- 3. Row-level security. Owner (migration/bootstrap connection) bypasses;
--    approvex_app is always subject to these policies.
------------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_roles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_tokens
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `permissions` is a global catalog: no RLS, SELECT-only for the app role.

------------------------------------------------------------------------------
-- 4. audit_events is append-only for EVERYONE, including the table owner.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();

------------------------------------------------------------------------------
-- 5. Permission catalog (spec section 4).
------------------------------------------------------------------------------
INSERT INTO permissions (id, key, description) VALUES
  (gen_random_uuid(), 'rule:create',      'Create and edit draft rules'),
  (gen_random_uuid(), 'rule:publish',     'Publish rule versions'),
  (gen_random_uuid(), 'workflow:create',  'Create and edit draft workflows'),
  (gen_random_uuid(), 'workflow:publish', 'Publish workflow versions'),
  (gen_random_uuid(), 'request:approve',  'Act on approval steps'),
  (gen_random_uuid(), 'audit:view',       'View the audit log'),
  (gen_random_uuid(), 'member:manage',    'Manage users, roles, and invitations'),
  (gen_random_uuid(), 'webhook:manage',   'Manage webhook endpoints')
ON CONFLICT (key) DO NOTHING;
