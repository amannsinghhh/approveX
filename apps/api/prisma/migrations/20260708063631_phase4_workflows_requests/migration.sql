-- CreateEnum
CREATE TYPE "rejection_policy" AS ENUM ('any_reject_kills', 'reject_returns_to_previous_step');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "step_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'superseded');

-- CreateEnum
CREATE TYPE "step_action_type" AS ENUM ('approve', 'reject', 'delegate', 'comment');

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "rule_status" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "rejection_policy" "rejection_policy" NOT NULL DEFAULT 'any_reject_kills',
    "published_at" TIMESTAMPTZ(6),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_workflow_bindings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_workflow_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "external_ref" TEXT,
    "context" TEXT,
    "title" TEXT,
    "payload" JSONB NOT NULL,
    "status" "request_status" NOT NULL DEFAULT 'pending',
    "matched_rule_version_id" UUID,
    "workflow_version_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "engine_state" JSONB NOT NULL DEFAULT '{}',
    "initial_response" JSONB,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_steps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" "step_status" NOT NULL DEFAULT 'pending',
    "assigned_role_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "escalated_to_role_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "step_action_type" NOT NULL,
    "comment" TEXT,
    "target_user_id" UUID,
    "on_behalf_of_user_id" UUID,
    "acted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflows_tenant_id_status_idx" ON "workflows"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenant_id_name_key" ON "workflows"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_id_version_key" ON "workflow_versions"("workflow_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "rule_workflow_bindings_rule_version_id_key" ON "rule_workflow_bindings"("rule_version_id");

-- CreateIndex
CREATE INDEX "requests_tenant_id_status_idx" ON "requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "requests_tenant_id_context_idx" ON "requests"("tenant_id", "context");

-- CreateIndex
CREATE UNIQUE INDEX "requests_tenant_id_idempotency_key_key" ON "requests"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "request_steps_tenant_id_status_idx" ON "request_steps"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "request_steps_status_due_at_idx" ON "request_steps"("status", "due_at");

-- CreateIndex
CREATE INDEX "request_steps_request_id_idx" ON "request_steps"("request_id");

-- CreateIndex
CREATE INDEX "step_actions_step_id_idx" ON "step_actions"("step_id");

-- CreateIndex
CREATE INDEX "delegations_tenant_id_to_user_id_idx" ON "delegations"("tenant_id", "to_user_id");

-- CreateIndex
CREATE INDEX "delegations_tenant_id_from_user_id_idx" ON "delegations"("tenant_id", "from_user_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_workflow_bindings" ADD CONSTRAINT "rule_workflow_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_workflow_bindings" ADD CONSTRAINT "rule_workflow_bindings_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_steps" ADD CONSTRAINT "request_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_steps" ADD CONSTRAINT "request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_actions" ADD CONSTRAINT "step_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_actions" ADD CONSTRAINT "step_actions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "request_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
