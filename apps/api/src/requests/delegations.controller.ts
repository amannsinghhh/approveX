import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { CreateDelegationDto } from './requests.schemas';
import { createDelegationSchema } from './requests.schemas';

@ApiTags('delegations')
@ApiBearerAuth()
@Controller('delegations')
export class DelegationsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Post()
  @ApiOperation({ summary: 'Create an out-of-office delegation window (self-service)' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDelegationSchema)) dto: CreateDelegationDto,
  ) {
    const client = this.tenantPrisma.forTenant(user.tenantId);
    if (dto.toUserId === user.userId) {
      throw new ForbiddenException('You cannot delegate to yourself');
    }
    const target = await client.user.findFirst({ where: { id: dto.toUserId, status: 'active' } });
    if (!target) throw new NotFoundException('Delegate user not found');
    return client.delegation.create({
      data: {
        tenantId: user.tenantId,
        fromUserId: user.userId,
        toUserId: dto.toUserId,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
      },
    });
  }

  @Get()
  @ApiOperation({ summary: 'My delegations (given and received)' })
  async list(@CurrentUser() user: AuthUser) {
    const client = this.tenantPrisma.forTenant(user.tenantId);
    const items = await client.delegation.findMany({
      where: { OR: [{ fromUserId: user.userId }, { toUserId: user.userId }] },
      orderBy: { startsAt: 'desc' },
    });
    return { items };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke one of my delegations' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const client = this.tenantPrisma.forTenant(user.tenantId);
    const delegation = await client.delegation.findUnique({ where: { id } });
    if (!delegation) throw new NotFoundException('Delegation not found');
    if (delegation.fromUserId !== user.userId) {
      throw new ForbiddenException('Only the delegator can revoke a delegation');
    }
    await client.delegation.delete({ where: { id } });
    return { id };
  }
}
