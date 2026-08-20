-- Addendum M1: field registry metadata (B.2).
-- Adds unit/precision/nullable/default_if_missing/source/enum_values to the
-- per-tenant field registry so the evaluator can coerce, default, and warn.
CREATE TYPE "field_source" AS ENUM ('payload', 'computed', 'looked_up');

ALTER TABLE "field_definitions"
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "precision" INTEGER,
  ADD COLUMN "nullable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "default_if_missing" JSONB,
  ADD COLUMN "source" "field_source" NOT NULL DEFAULT 'payload',
  ADD COLUMN "enum_values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
