import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type {
  CreateDecisionTableDto,
  ListTablesQuery,
  TestDecisionTableDto,
  UpdateDecisionTableDto,
  UpsertTableDraftDto,
} from './decision-tables.schemas';
import {
  createDecisionTableSchema,
  listTablesQuerySchema,
  testDecisionTableSchema,
  updateDecisionTableSchema,
  upsertTableDraftSchema,
} from './decision-tables.schemas';
import { DecisionTablesService } from './decision-tables.service';

@ApiTags('decision-tables')
@ApiBearerAuth()
@Controller('decision-tables')
export class DecisionTablesController {
  constructor(private readonly tables: DecisionTablesService) {}

  @Post()
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Create a decision table with its first draft version' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDecisionTableSchema)) dto: CreateDecisionTableDto,
  ) {
    return this.tables.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List decision tables' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listTablesQuerySchema)) query: ListTablesQuery,
  ) {
    return this.tables.list(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Decision table detail including versions' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tables.get(user.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Update metadata (name, description)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDecisionTableSchema)) dto: UpdateDecisionTableDto,
  ) {
    return this.tables.updateMetadata(user.tenantId, id, dto);
  }

  @Put(':id/draft')
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Create or update the draft version' })
  upsertDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertTableDraftSchema)) dto: UpsertTableDraftDto,
  ) {
    return this.tables.upsertDraft(user.tenantId, id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions('rule:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft version (immutable from then on)' })
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.tables.publish(user.tenantId, user.userId, id, ip);
  }

  @Post(':id/archive')
  @RequirePermissions('rule:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a decision table' })
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tables.archive(user.tenantId, user.userId, id);
  }

  @Delete(':id')
  @RequirePermissions('rule:create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a never-published decision table' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tables.remove(user.tenantId, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dry-run a payload against the latest version (no side effects)' })
  test(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(testDecisionTableSchema)) dto: TestDecisionTableDto,
  ) {
    return this.tables.test(user.tenantId, id, dto);
  }
}
