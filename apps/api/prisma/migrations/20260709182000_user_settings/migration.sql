-- Addendum M3: per-user UI preferences (Part A dismissal flags, etc.).
-- Self-scoped, mutated only via GET/PATCH /me/settings.
ALTER TABLE "users" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
