import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PUBLISHED_HEAD_SELECT, workflowsReferencingRole } from '../common/workflow-role-refs';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { ListUsersQuery, UpdateSettingsDto, UpdateUserDto } from './users.schemas';

type JsonObject = Record<string, unknown>;

const asSettings = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  userRoles: { select: { role: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: ListUsersQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const [items, total] = await Promise.all([
      client.user.findMany({
        select: USER_SELECT,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      client.user.count(),
    ]);
    return {
      items: items.map((user) => this.shape(user)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async me(tenantId: string, userId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const [user, tenant] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
        select: {
          ...USER_SELECT,
          settings: true,
          userRoles: {
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  rolePermissions: { select: { permission: { select: { key: true } } } },
                },
              },
            },
          },
        },
      }),
      client.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)),
      ),
    ].sort();

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      settings: asSettings(user.settings),
      roles: user.userRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name })),
      permissions,
      tenant,
    };
  }

  /** Self-scoped: a user's own UI preferences. No member:manage needed. */
  async getSettings(tenantId: string, userId: string): Promise<JsonObject> {
    const user = await this.tenantPrisma
      .forTenant(tenantId)
      .user.findUnique({ where: { id: userId }, select: { settings: true } });
    if (!user) throw new NotFoundException('User not found');
    return asSettings(user.settings);
  }

  /** Shallow-merge the patch into existing settings so one key can change alone. */
  async updateSettings(
    tenantId: string,
    userId: string,
    patch: UpdateSettingsDto,
  ): Promise<JsonObject> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const current = await client.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!current) throw new NotFoundException('User not found');

    const merged: JsonObject = { ...asSettings(current.settings), ...patch };
    await client.user.update({ where: { id: userId }, data: { settings: merged } });
    return merged;
  }

  async get(tenantId: string, userId: string) {
    const user = await this.tenantPrisma.forTenant(tenantId).user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    // Cross-tenant UUIDs resolve to nothing under RLS — 404, never 403.
    if (!user) throw new NotFoundException('User not found');
    return this.shape(user);
  }

  async update(tenantId: string, actorUserId: string, userId: string, dto: UpdateUserDto) {
    if (dto.status === 'deactivated' && userId === actorUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const client = this.tenantPrisma.forTenant(tenantId);
    const before = await client.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!before) throw new NotFoundException('User not found');

    if (dto.roleIds) {
      const roles = await client.role.findMany({ where: { id: { in: dto.roleIds } } });
      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more roles do not exist');
      }
    }

    const after = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId, roleId, tenantId })),
        });
      }
      if (dto.status) {
        await tx.user.update({ where: { id: userId }, data: { status: dto.status } });
        if (dto.status === 'deactivated') {
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'user.updated',
      entityType: 'user',
      entityId: userId,
      before: this.shape(before),
      after: this.shape(after),
    });

    return this.shape(after);
  }

  /**
   * A.1 #3 — consequence preview: which approvals stall if this user is
   * deactivated. A role stalls when this user is its *only* active member and
   * a published workflow routes to it (or steps are already pending on it).
   */
  async consequences(tenantId: string, userId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const user = await client.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');

    const roleIds = user.userRoles.map((ur) => ur.role.id);
    let soleApproverRoles: {
      id: string;
      name: string;
      workflows: ReturnType<typeof workflowsReferencingRole>;
      pendingSteps: number;
    }[] = [];

    if (roleIds.length > 0) {
      const otherActiveMembers = await client.userRole.findMany({
        where: {
          roleId: { in: roleIds },
          userId: { not: userId },
          user: { status: 'active' },
        },
        select: { roleId: true },
      });
      const covered = new Set(otherActiveMembers.map((row) => row.roleId));
      const soleRoles = user.userRoles.filter((ur) => !covered.has(ur.role.id));

      if (soleRoles.length > 0) {
        const workflowRows = await client.workflow.findMany({ select: PUBLISHED_HEAD_SELECT });
        soleApproverRoles = await Promise.all(
          soleRoles.map(async (ur) => ({
            id: ur.role.id,
            name: ur.role.name,
            workflows: workflowsReferencingRole(workflowRows, ur.role.id),
            pendingSteps: await client.requestStep.count({
              where: {
                status: 'pending',
                OR: [{ assignedRoleId: ur.role.id }, { escalatedToRoleId: ur.role.id }],
              },
            }),
          })),
        );
        // Only roles whose loss actually stalls something are consequences.
        soleApproverRoles = soleApproverRoles.filter(
          (role) => role.workflows.length > 0 || role.pendingSteps > 0,
        );
      }
    }

    return {
      user: { id: user.id, name: user.name, status: user.status },
      soleApproverRoles,
      safeToDeactivate: soleApproverRoles.length === 0,
    };
  }

  private shape(user: {
    id: string;
    email: string;
    name: string;
    status: string;
    createdAt: Date;
    userRoles: { role: { id: string; name: string } }[];
  }) {
    const { userRoles, ...rest } = user;
    return { ...rest, roles: userRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name })) };
  }
}
