import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { ApiKeyScopes, CurrentUser, RequirePermissions } from '../common/decorators';
import { RateLimited } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type {
  ApproveStepDto,
  CreateRequestDto,
  DelegateStepDto,
  ListRequestsQuery,
  RejectStepDto,
} from './requests.schemas';
import {
  approveStepSchema,
  createRequestSchema,
  delegateStepSchema,
  listRequestsQuerySchema,
  rejectStepSchema,
} from './requests.schemas';
import { RequestEngineService } from './request-engine.service';
import { RequestsService } from './requests.service';

@ApiTags('requests')
@ApiBearerAuth()
@Controller()
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly engine: RequestEngineService,
  ) {}

  @Post('requests')
  @ApiKeyScopes('request:create')
  @RateLimited()
  @ApiOperation({ summary: 'Create a request directly (skip rule matching)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRequestSchema)) dto: CreateRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.requests.createDirect(user.tenantId, user.userId, dto, idempotencyKey, ip);
  }

  @Get('requests')
  @ApiKeyScopes('request:read')
  @ApiOperation({ summary: 'List requests (filterable, paginated)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery,
  ) {
    return this.requests.list(user.tenantId, query);
  }

  @Get('requests/:id')
  @ApiKeyScopes('request:read')
  @ApiOperation({ summary: 'Full request detail: steps, actions, pending approvers' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user.tenantId, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending request (requester or admin)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.requests.cancel(user.tenantId, user, id, ip);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending steps the current user can act on' })
  inbox(@CurrentUser() user: AuthUser) {
    return this.requests.inbox(user.tenantId, user.userId);
  }

  @Post('steps/:id/approve')
  @RequirePermissions('request:approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a step' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approveStepSchema)) dto: ApproveStepDto,
    @Ip() ip: string,
  ) {
    return this.engine.act(user.tenantId, user, id, 'approve', dto, ip);
  }

  @Post('steps/:id/reject')
  @RequirePermissions('request:approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a step (comment required)' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectStepSchema)) dto: RejectStepDto,
    @Ip() ip: string,
  ) {
    return this.engine.act(user.tenantId, user, id, 'reject', dto, ip);
  }

  @Post('steps/:id/delegate')
  @RequirePermissions('request:approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delegate a step to another user' })
  delegate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(delegateStepSchema)) dto: DelegateStepDto,
    @Ip() ip: string,
  ) {
    return this.engine.act(user.tenantId, user, id, 'delegate', dto, ip);
  }
}
