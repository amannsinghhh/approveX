import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CreateRoleDto, UpdateRoleDto } from './roles.schemas';
import { createRoleSchema, updateRoleSchema } from './roles.schemas';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @ApiOperation({ summary: 'List roles' })
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(user.tenantId);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Global permission catalog' })
  permissions(@CurrentUser() user: AuthUser) {
    return this.roles.listPermissionCatalog(user.tenantId);
  }

  @Post('roles')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Create a role' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleDto,
  ) {
    return this.roles.create(user.tenantId, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Update a role (name, description, permissions)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleDto,
  ) {
    return this.roles.update(user.tenantId, user.userId, id, dto);
  }

  @Get('roles/:id/consequences')
  @RequirePermissions('member:manage')
  @ApiOperation({ summary: 'Preview what breaks if this role is deleted (A.1 #3)' })
  consequences(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.consequences(user.tenantId, id);
  }

  @Delete('roles/:id')
  @RequirePermissions('member:manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a non-system role (409 if workflows/steps still use it)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(user.tenantId, id);
  }
}
