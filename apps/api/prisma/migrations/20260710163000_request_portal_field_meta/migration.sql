-- CreateEnum
CREATE TYPE "field_input_type" AS ENUM ('text', 'number', 'currency', 'date', 'select', 'textarea', 'checkbox', 'file');

-- AlterTable
-- P0.1 Request Portal: mark fields as user-submittable and carry the form copy.
ALTER TABLE "field_definitions" ADD COLUMN     "user_submittable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contexts" TEXT[] DEFAULT '{}',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "help_text" TEXT,
ADD COLUMN     "input_type" "field_input_type",
ADD COLUMN     "display_order" INTEGER;
