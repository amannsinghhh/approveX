import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { RateLimited } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { MyRequestsQuery, SubmitRequestDto } from './portal.schemas';
import { myRequestsQuerySchema, submitRequestSchema } from './portal.schemas';
import { PortalService } from './portal.service';

/**
 * P0.1 Request Portal — the self-service surface. Every route here is open to
 * any authenticated human (no @RequirePermissions): submitting a request and
 * seeing your own are baseline abilities. API keys are rejected fail-closed by
 * the PermissionsGuard, since these routes carry no @ApiKeyScopes.
 */
@ApiTags('portal')
@ApiBearerAuth()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('contexts')
  @ApiOperation({ summary: 'Submission types the current user can pick from' })
  contexts(@CurrentUser() user: AuthUser) {
    return this.portal.listContexts(user.tenantId);
  }

  @Get('contexts/:context')
  @ApiOperation({ summary: 'The generated form (ordered fields) for one context' })
  form(@CurrentUser() user: AuthUser, @Param('context') context: string) {
    return this.portal.getForm(user.tenantId, context);
  }

  @Post('contexts/:context/requests')
  @RateLimited()
  @ApiOperation({ summary: 'Submit the generated form; routes via rule-matching' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('context') context: string,
    @Body(new ZodValidationPipe(submitRequestSchema)) dto: SubmitRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.portal.submit(user.tenantId, user.userId, context, dto, idempotencyKey, ip);
  }

  @Get('my-requests')
  @ApiOperation({ summary: "Requests the current user themselves submitted" })
  myRequests(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(myRequestsQuerySchema)) query: MyRequestsQuery,
  ) {
    return this.portal.myRequests(user.tenantId, user.userId, query);
  }
}
