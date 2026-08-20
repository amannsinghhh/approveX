import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { OutboxService } from './outbox.service';
import type { CreateWebhookDto, DeliveriesQuery, UpdateWebhookDto } from './webhooks.schemas';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  list(tenantId: string) {
    return this.tenantPrisma
      .forTenant(tenantId)
      .webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' } });
  }

  create(tenantId: string, dto: CreateWebhookDto) {
    return this.tenantPrisma.forTenant(tenantId).webhookEndpoint.create({
      data: { tenantId, ...dto },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Webhook endpoint not found');
    return client.webhookEndpoint.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Webhook endpoint not found');
    await client.webhookEndpoint.delete({ where: { id } });
    return { deleted: true };
  }

  /** Per-tenant signing secret; delivered payloads are HMAC'd with this. */
  async getSecret(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { webhookSecret: true },
    });
    return { secret: tenant.webhookSecret };
  }

  /** Rotation invalidates signatures immediately — consumers must switch first. */
  async rotateSecret(tenantId: string) {
    const secret = randomBytes(32).toString('hex');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { webhookSecret: secret } });
    return { secret };
  }

  async deliveries(tenantId: string, endpointId: string, query: DeliveriesQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const endpoint = await client.webhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    const where = { endpointId };
    const [items, total] = await Promise.all([
      client.webhookOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      client.webhookOutbox.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Enqueues a signed `ping` event so integrators can verify their receiver. */
  async ping(tenantId: string, endpointId: string) {
    return this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: endpointId } });
      if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
      await this.outbox.enqueue(
        tx,
        tenantId,
        'ping',
        { message: 'ApproveX test delivery' },
        { endpointId },
      );
      return { enqueued: true };
    });
  }
}
