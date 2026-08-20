-- CreateEnum
CREATE TYPE "rule_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "field_def_type" AS ENUM ('number', 'string', 'boolean', 'date');

-- CreateTable
CREATE TABLE "field_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "field_def_type" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "context" TEXT NOT NULL,
    "status" "rule_status" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "condition_ast" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effective_from" TIMESTAMPTZ(6),
    "effective_to" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_tenant_id_name_key" ON "field_definitions"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "rules_tenant_id_context_status_idx" ON "rules"("tenant_id", "context", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rules_tenant_id_name_key" ON "rules"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "rule_versions_tenant_id_priority_idx" ON "rule_versions"("tenant_id", "priority");

-- CreateIndex
CREATE INDEX "rule_versions_condition_ast_idx" ON "rule_versions" USING GIN ("condition_ast");

-- CreateIndex
CREATE UNIQUE INDEX "rule_versions_rule_id_version_key" ON "rule_versions"("rule_id", "version");

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
