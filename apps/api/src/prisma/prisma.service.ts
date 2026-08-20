import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Owner connection (DATABASE_URL). Bypasses RLS — reserved for migrations,
 * auth bootstrap (signup/login happen before a tenant context exists), and
 * system writes like audit events. Tenant-scoped domain queries must go
 * through TenantPrismaService instead.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
