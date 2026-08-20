-- CreateEnum
CREATE TYPE "lookup_fallback" AS ENUM ('treat_as_no_match', 'use_cached_value', 'block_and_alert');

-- AlterTable
ALTER TABLE "field_definitions" ADD COLUMN     "lookup_fallback" "lookup_fallback" NOT NULL DEFAULT 'treat_as_no_match',
ADD COLUMN     "lookup_url" TEXT;
