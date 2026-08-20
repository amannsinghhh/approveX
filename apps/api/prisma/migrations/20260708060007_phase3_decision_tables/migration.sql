-- CreateEnum
CREATE TYPE "hit_policy" AS ENUM ('first', 'all');

-- CreateTable
CREATE TABLE "decision_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "context" TEXT NOT NULL,
    "status" "rule_status" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_table_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "hit_policy" "hit_policy" NOT NULL DEFAULT 'first',
    "published_at" TIMESTAMPTZ(6),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_table_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_tables_tenant_id_context_status_idx" ON "decision_tables"("tenant_id", "context", "status");

-- CreateIndex
CREATE UNIQUE INDEX "decision_tables_tenant_id_name_key" ON "decision_tables"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "decision_table_versions_table_id_version_key" ON "decision_table_versions"("table_id", "version");

-- AddForeignKey
ALTER TABLE "decision_tables" ADD CONSTRAINT "decision_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_table_versions" ADD CONSTRAINT "decision_table_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_table_versions" ADD CONSTRAINT "decision_table_versions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "decision_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
