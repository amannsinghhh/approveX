import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

const auditQuerySchema = z
  .object({
    entity: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

type AuditQuery = z.infer<typeof auditQuerySchema>;

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @RequirePermissions('audit:view')
  @ApiOperation({ summary: 'List audit events (audit:view required)' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    const client = this.tenantPrisma.forTenant(user.tenantId);
    const where = {
      ...(query.entity ? { entityType: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      client.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      client.auditEvent.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
