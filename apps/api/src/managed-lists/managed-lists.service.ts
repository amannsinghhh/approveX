import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RuleCacheService } from '../rules/rule-cache.service';
import type { CreateManagedListDto, UpdateManagedListDto } from './managed-lists.schemas';

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  values: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Trim, drop blanks, and de-duplicate — IN_LIST membership treats the list as a set. */
function normalizeValues(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

/**
 * CRUD for per-tenant managed value lists. Every mutation invalidates the
 * `lists:<tenantId>` cache the evaluation hot path reads, so IN_LIST checks
 * pick up edits without waiting for the TTL backstop.
 */
@Injectable()
export class ManagedListsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ruleCache: RuleCacheService,
  ) {}

  async list(tenantId: string) {
    const items = await this.tenantPrisma
      .forTenant(tenantId)
      .managedList.findMany({ select: LIST_SELECT, orderBy: { name: 'asc' } });
    return { items };
  }

  async create(tenantId: string, dto: CreateManagedListDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.managedList.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A list with this name already exists');

    const list = await client.managedList.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        values: normalizeValues(dto.values),
      },
      select: LIST_SELECT,
    });
    await this.ruleCache.invalidateManagedLists(tenantId);
    return list;
  }

  async update(tenantId: string, listId: string, dto: UpdateManagedListDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const before = await client.managedList.findUnique({
      where: { id: listId },
      select: { id: true },
    });
    if (!before) throw new NotFoundException('Managed list not found');

    if (dto.name !== undefined) {
      const clash = await client.managedList.findFirst({
        where: { name: dto.name, id: { not: listId } },
      });
      if (clash) throw new ConflictException('A list with this name already exists');
    }

    const list = await client.managedList.update({
      where: { id: listId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.values !== undefined ? { values: normalizeValues(dto.values) } : {}),
      },
      select: LIST_SELECT,
    });
    await this.ruleCache.invalidateManagedLists(tenantId);
    return list;
  }

  async remove(tenantId: string, listId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.managedList.findUnique({
      where: { id: listId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Managed list not found');

    await client.managedList.delete({ where: { id: listId } });
    await this.ruleCache.invalidateManagedLists(tenantId);
    return { id: listId };
  }
}
