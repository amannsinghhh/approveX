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
  BindWorkflowDto,
  CreateWorkflowDto,
  ListWorkflowsQuery,
  UpdateWorkflowDto,
  UpsertWorkflowDraftDto,
  ValidateWorkflowDto,
} from './workflows.schemas';
import {
  bindWorkflowSchema,
  createWorkflowSchema,
  listWorkflowsQuerySchema,
  updateWorkflowSchema,
  upsertWorkflowDraftSchema,
  validateWorkflowSchema,
} from './workflows.schemas';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post('workflows')
  @RequirePermissions('workflow:create')
  @ApiOperation({ summary: 'Create a workflow with its first draft version' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkflowSchema)) dto: CreateWorkflowDto,
  ) {
    return this.workflows.create(user.tenantId, dto);
  }

  @Get('workflows')
  @ApiOperation({ summary: 'List workflows' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listWorkflowsQuerySchema)) query: ListWorkflowsQuery,
  ) {
    return this.workflows.list(user.tenantId, query);
  }

  @Get('workflows/:id')
  @ApiOperation({ summary: 'Workflow detail including versions' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.get(user.tenantId, id);
  }

  @Patch('workflows/:id')
  @RequirePermissions('workflow:create')
  @ApiOperation({ summary: 'Update metadata (name, description)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowDto,
  ) {
    return this.workflows.updateMetadata(user.tenantId, id, dto);
  }

  @Put('workflows/:id/draft')
  @RequirePermissions('workflow:create')
  @ApiOperation({ summary: 'Create or update the draft version' })
  upsertDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertWorkflowDraftSchema)) dto: UpsertWorkflowDraftDto,
  ) {
    return this.workflows.upsertDraft(user.tenantId, id, dto);
  }

  @Post('workflows/validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a graph without saving (builder support)' })
  validate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(validateWorkflowSchema)) dto: ValidateWorkflowDto,
  ) {
    return this.workflows.validate(user.tenantId, dto.graph, dto.rejectionPolicy);
  }

  @Post('workflows/:id/publish')
  @RequirePermissions('workflow:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft version (immutable from then on)' })
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.workflows.publish(user.tenantId, user.userId, id, ip);
  }

  @Post('workflows/:id/archive')
  @RequirePermissions('workflow:publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a workflow' })
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.archive(user.tenantId, user.userId, id);
  }

  @Delete('workflows/:id')
  @RequirePermissions('workflow:create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a never-published workflow' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.remove(user.tenantId, id);
  }

  @Put('rules/:ruleId/binding')
  @RequirePermissions('rule:publish')
  @ApiOperation({ summary: "Bind a rule's current version to a workflow" })
  bind(
    @CurrentUser() user: AuthUser,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(new ZodValidationPipe(bindWorkflowSchema)) dto: BindWorkflowDto,
  ) {
    return this.workflows.bindRule(user.tenantId, ruleId, dto.workflowId);
  }
}
