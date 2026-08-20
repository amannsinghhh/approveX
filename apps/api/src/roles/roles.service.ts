import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PUBLISHED_HEAD_SELECT, workflowsReferencingRole } from '../common/workflow-role-refs';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CreateRoleDto, UpdateRoleDto } from './roles.schemas';

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  createdAt: true,
  rolePermissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { userRoles: true } },
} as const;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  rolePermissions: { permission: { key: string } }[];
  _count: { userRoles: number };
};

const shape = (role: RoleRow) => ({
  id: role.id,
  name: role.name,
  description: role.description,
  isSystem: role.isSystem,
  createdAt: role.createdAt,
  permissions: role.rolePermissions.map((rp) => rp.permission.key).sort(),
  memberCount: role._count.userRoles,
});

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    const items = await this.tenantPrisma
      .forTenant(tenantId)
      .role.findMany({ select: ROLE_SELECT, orderBy: { createdAt: 'asc' } });
    return { items: items.map(shape) };
  }

  async listPermissionCatalog(tenantId: string) {
    const items = await this.tenantPrisma
      .forTenant(tenantId)
      .permission.findMany({ select: { key: true, description: true }, orderBy: { key: 'asc' } });
    return { items };
  }

  async create(tenantId: string, dto: CreateRoleDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.role.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A role with this name already exists');

    const permissions = await client.permission.findMany({
      where: { key: { in: dto.permissionKeys } },
      select: { id: true },
    });

    const role = await client.role.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        rolePermissions: {
          create: permissions.map((perm) => ({ permissionId: perm.id, tenantId })),
        },
      },
      select: ROLE_SELECT,
    });
    return shape(role);
  }

  async update(tenantId: string, actorUserId: string, roleId: string, dto: UpdateRoleDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const before = await client.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
    if (!before) throw new NotFoundException('Role not found');
    if (before.isSystem) throw new ForbiddenException('System roles cannot be modified');

    const after = await this.tenantPrisma.transactionForTenant(tenantId, async (tx) => {
      if (dto.permissionKeys) {
        const permissions = await tx.permission.findMany({
          where: { key: { in: dto.permissionKeys } },
          select: { id: true },
        });
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissions.map((perm) => ({ roleId, permissionId: perm.id, tenantId })),
        });
      }
      return tx.role.update({
        where: { id: roleId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        select: ROLE_SELECT,
      });
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      eventType: 'role.updated',
      entityType: 'role',
      entityId: roleId,
      before: shape(before),
      after: shape(after),
    });

    return shape(after);
  }

  async remove(tenantId: string, roleId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const role = await client.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');

    // A.1 #3 — refuse deletes that would strand live approvals. The same data
    // is available read-only via GET roles/:id/consequences for the UI to
    // show *before* the admin clicks delete.
    const { workflows, pendingSteps } = await this.usage(tenantId, roleId);
    if (workflows.length > 0 || pendingSteps > 0) {
      throw new ConflictException({
        message:
          `Role "${role.name}" is still in use — deleting it would stall approvals. ` +
          'Repoint the workflows below (and let pending steps finish) first.',
        workflows: workflows.map((ref) => ({ id: ref.id, name: ref.name })),
        pendingSteps,
      });
    }

    await client.role.delete({ where: { id: roleId } }); // memberships cascade
    return { id: roleId };
  }

  /** A.1 #3 — consequence preview: what breaks if this role is deleted. */
  async consequences(tenantId: string, roleId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const role = await client.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
    if (!role) throw new NotFoundException('Role not found');

    const { workflows, pendingSteps } = await this.usage(tenantId, roleId);
    return {
      role: {
        id: role.id,
        name: role.name,
        isSystem: role.isSystem,
        memberCount: role._count.userRoles,
      },
      workflows,
      pendingSteps,
      deletable: !role.isSystem && workflows.length === 0 && pendingSteps === 0,
    };
  }

  /** Published workflow heads routing to this role + live steps waiting on it. */
  private async usage(tenantId: string, roleId: string) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const [workflowRows, pendingSteps] = await Promise.all([
      client.workflow.findMany({ select: PUBLISHED_HEAD_SELECT }),
      client.requestStep.count({
        where: {
          status: 'pending',
          OR: [{ assignedRoleId: roleId }, { escalatedToRoleId: roleId }],
        },
      }),
    ]);
    return { workflows: workflowsReferencingRole(workflowRows, roleId), pendingSteps };
  }
}
