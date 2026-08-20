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
import type { CreateRuleDto, ListRulesQuery, UpdateRuleDto, UpsertDraftDto } from './rules.schemas';
import {
  createRuleSchema,
  listRulesQuerySchema,
  updateRuleSchema,
  upsertDraftSchema,
} from './rules.schemas';
import { RulesService } from './rules.service';

@ApiTags('rules')
@ApiBearerAuth()
@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Post()
  @RequirePermissions('rule:create')
  @ApiOperation({
    summary: 'Create a rule with its first draft version',
    description:
      'ruleType "condition_tree" (default) takes conditionAst; "scoring" takes scoringSpec — ' +
      'weighted factors summed and compared with a threshold.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRuleSchema)) dto: CreateRuleDto,
  ) {
    return this.rules.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List rules' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listRulesQuerySchema)) query: ListRulesQuery,
  ) {
    return this.rules.list(user.tenantId, query);
  }

  @Get('contexts/health')
  @ApiOperation({ summary: 'Per-context fallback (catch-all) coverage' })
  contextsHealth(@CurrentUser() user: AuthUser) {
    return this.rules.contextsHealth(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Rule detail including all versions' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.get(user.tenantId, id);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Version history' })
  versions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.listVersions(user.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('rule:create')
  @ApiOperation({ summary: 'Update rule metadata (name, description)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRuleSchema)) dto: UpdateRuleDto,
  ) {
    return this.rules.updateMetadata(user.tenantId, id, dto);
  }

  @Put(':id/draft')
  @RequirePermissions('rule:create')
  @ApiOperation({
    summary: 'Create or update the draft version (new version if head is published)',
  })
  upsertDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertDraftSchema)) dto: UpsertDraftDto,
  ) {
    return this.rules.upsertDraft(user.tenantId, id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions('rule:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft version (immutable from then on)' })
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.rules.publish(user.tenantId, user.userId, id, ip);
  }

  @Post(':id/archive')
  @RequirePermissions('rule:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a rule (excluded from evaluation)' })
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.archive(user.tenantId, user.userId, id);
  }

  @Delete(':id')
  @RequirePermissions('rule:create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a never-published rule' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.remove(user.tenantId, id);
  }
}
