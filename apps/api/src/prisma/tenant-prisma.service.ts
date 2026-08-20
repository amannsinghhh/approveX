import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

/**
 * RLS-enforced connection. Connects as the non-owner Postgres role
 * `approvex_app` (APP_DATABASE_URL), so row-level security always applies:
 * without `app.tenant_id` set on the transaction, every query returns zero
 * rows — a missing tenant filter fails closed instead of leaking data.
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly base: PrismaClient;

  constructor() {
    const url = process.env.APP_DATABASE_URL;
    if (!url) throw new Error('APP_DATABASE_URL is not set');
    this.base = new PrismaClient({ datasources: { db: { url } } });
  }

  /**
   * Client whose every model operation runs in a transaction that first sets
   * `app.tenant_id`, activating the RLS policies for this tenant.
   * Pattern from Prisma's official row-level-security extension example.
   */
  forTenant(tenantId: string) {
    const base = this.base;
    return base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    });
  }

  /**
   * Multi-statement transaction under one tenant context — use when several
   * writes must commit atomically (e.g. accept invitation = user + roles).
   */
  async transactionForTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return fn(tx);
    });
  }

  /** Raw access for tests and diagnostics — still RLS-enforced (no tenant context). */
  get raw(): PrismaClient {
    return this.base;
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}

export type TenantClient = ReturnType<TenantPrismaService['forTenant']>;
