-- AlterEnum
-- Extend hit_policy with the CP1 shared-engine hit policies (unique, best).
-- ADD VALUE is idempotent-safe via IF NOT EXISTS so re-runs against a
-- partially-migrated DB do not fail.
ALTER TYPE "hit_policy" ADD VALUE IF NOT EXISTS 'unique';
ALTER TYPE "hit_policy" ADD VALUE IF NOT EXISTS 'best';
