import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  tenantId: string;
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'api_key';
  eventType: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SENSITIVE_KEY = /password|token|secret|authorization/i;

/** Recursively replaces sensitive values so credentials never reach the audit log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(val),
      ]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  // Writes go through the owner connection: audit rows must land even when the
  // acting context is a bootstrap flow (signup) with no RLS tenant set yet.
  // tenantId is always explicit, and the append-only trigger guards the table.
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          tenantId: entry.tenantId,
          actorUserId: entry.actorUserId ?? null,
          actorType: entry.actorType ?? 'user',
          eventType: entry.eventType,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: (redact(entry.before) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (redact(entry.after) ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      // An audit failure must not take the request down, but it must be loud.
      this.logger.error(`Failed to write audit event ${entry.eventType}`, err);
    }
  }
}
