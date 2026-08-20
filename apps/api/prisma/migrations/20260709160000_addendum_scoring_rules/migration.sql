-- Addendum M2: scoring rules (B.3 #3).
-- A rule version is now either a condition tree (condition_ast) or a weighted
-- scoring spec (scoring_spec). Existing rows are condition trees, which the
-- enum default backfills; condition_ast becomes nullable so a scoring version
-- carries no vestigial AST, and a CHECK keeps the two shapes exclusive.
CREATE TYPE "rule_type" AS ENUM ('condition_tree', 'scoring');

ALTER TABLE "rule_versions"
  ADD COLUMN "rule_type" "rule_type" NOT NULL DEFAULT 'condition_tree',
  ADD COLUMN "scoring_spec" JSONB,
  ALTER COLUMN "condition_ast" DROP NOT NULL;

ALTER TABLE "rule_versions"
  ADD CONSTRAINT "rule_versions_type_payload_chk" CHECK (
    (rule_type = 'condition_tree' AND condition_ast IS NOT NULL AND scoring_spec IS NULL)
    OR (rule_type = 'scoring' AND scoring_spec IS NOT NULL AND condition_ast IS NULL)
  );
