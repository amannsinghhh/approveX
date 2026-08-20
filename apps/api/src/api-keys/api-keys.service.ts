import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CreateApiKeyDto } from './api-keys.schemas';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class ApiKeysService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** The plaintext key is returned exactly once; only its sha256 is stored. */
  async create(tenantId: string, createdById: string, dto: CreateApiKeyDto) {
    const key = `ax_${randomBytes(24).toString('hex')}`;
    const client = this.tenantPrisma.forTenant(tenantId);

    const existing = await client.apiKey.findFirst({
      where: { name: dto.name, revokedAt: null },
    });
    if (existing) throw new ConflictException('An active API key with this name already exists');

    const created = await client.apiKey.create({
      data: {
        tenantId,
        name: dto.name,
        prefix: key.slice(0, 10),
        keyHash: sha256(key),
        scopes: dto.scopes,
        createdById,
      },
    });
    return {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      createdAt: created.createdAt,
      /** Shown once — store it now, it cannot be retrieved again. */
      key,
    };
  }

  list(tenantId: string) {
    return this.tenantPrisma.forTenant(tenantId).apiKey.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(tenantId: string, id: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const key = await client.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) throw new ConflictException('API key is already revoked');
    await client.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }
}
