# Dev image — production multi-stage build lands in Phase 7 (deploy scripts).
FROM node:22-alpine
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @approvex/shared build

CMD ["pnpm", "--filter", "@approvex/worker", "dev"]
