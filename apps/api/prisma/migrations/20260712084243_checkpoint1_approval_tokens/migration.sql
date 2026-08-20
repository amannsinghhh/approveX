-- CreateEnum
CREATE TYPE "approval_channel" AS ENUM ('web', 'email', 'whatsapp', 'api', 'tally');

-- AlterTable
ALTER TABLE "step_actions" ADD COLUMN     "channel" "approval_channel" NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE "approval_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "channel" "approval_channel" NOT NULL,
    "allowed_actions" "step_action_type"[],
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "consumed_action" "step_action_type",
    "consumed_ip" TEXT,
    "consumed_user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_tokens_token_hash_key" ON "approval_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "approval_tokens_step_id_idx" ON "approval_tokens"("step_id");

-- CreateIndex
CREATE INDEX "approval_tokens_tenant_id_idx" ON "approval_tokens"("tenant_id");

-- AddForeignKey
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "request_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
