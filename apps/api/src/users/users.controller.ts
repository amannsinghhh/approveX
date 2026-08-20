import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { ListUsersQuery, UpdateSettingsDto, UpdateUserDto } from './users.schemas';
import { listUsersQuerySchema, updateSettingsSchema, updateUserSchema } from './users.schemas';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user with roles, permissions, and tenant' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.tenantId, user.userId);
  }

  @Get('me/settings')
  @ApiOperation({ summary: 'Current user UI preferences (self-scoped)' })
  getSettings(@CurrentUser() user: AuthUser) {
    return this.users.getSettings(user.tenantId, user.userId);
  }

  @Patch('me/settings')
  @ApiOperation({ summary: 'Shallow-merge UI preferences (self-scoped)' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateSettingsSchema)) dto: UpdateSettingsDto,
  ) {
    return this.users.updateSettings(user.tenantId, user.userId, dto);
  }

  @Get('users')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'List users in the tenant' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    return this.users.list(user.tenantId, query);
  }

  @Get('users/:id')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Get a user by id (404 for other tenants)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user.tenantId, id);
  }

  @Get('users/:id/consequences')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Preview which approvals stall if this user is deactivated (A.1 #3)' })
  consequences(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.consequences(user.tenantId, id);
  }

  @Patch('users/:id')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Update a user (status and/or roles)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.users.update(user.tenantId, user.userId, id, dto);
  }
}
