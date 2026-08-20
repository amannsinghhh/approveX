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
import type { CreateFieldDto, UpdateFieldDto } from './fields.schemas';
import { createFieldSchema, updateFieldSchema } from './fields.schemas';
import { FieldsService } from './fields.service';

@ApiTags('fields')
@ApiBearerAuth()
@Controller('fields')
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @Get()
  @ApiOperation({ summary: 'Field schema registry (drives builder dropdowns and coercion)' })
  list(@CurrentUser() user: AuthUser) {
    return this.fields.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Define a field' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFieldSchema)) dto: CreateFieldDto,
  ) {
    return this.fields.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Update a field definition' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFieldSchema)) dto: UpdateFieldDto,
  ) {
    return this.fields.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('rule:create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a field definition' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.remove(user.tenantId, id);
  }
}
