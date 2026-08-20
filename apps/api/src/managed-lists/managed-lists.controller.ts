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
import type { CreateManagedListDto, UpdateManagedListDto } from './managed-lists.schemas';
import { createManagedListSchema, updateManagedListSchema } from './managed-lists.schemas';
import { ManagedListsService } from './managed-lists.service';

@ApiTags('managed-lists')
@ApiBearerAuth()
@Controller('managed-lists')
export class ManagedListsController {
  constructor(private readonly lists: ManagedListsService) {}

  @Get()
  @ApiOperation({ summary: 'List managed value lists' })
  list(@CurrentUser() user: AuthUser) {
    return this.lists.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Create a managed list' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createManagedListSchema)) dto: CreateManagedListDto,
  ) {
    return this.lists.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Update a managed list (name, description, values)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateManagedListSchema)) dto: UpdateManagedListDto,
  ) {
    return this.lists.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('rule:create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a managed list' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lists.remove(user.tenantId, id);
  }
}
