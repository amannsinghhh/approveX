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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CreateWebhookDto, DeliveriesQuery, UpdateWebhookDto } from './webhooks.schemas';
import {
  createWebhookSchema,
  deliveriesQuerySchema,
  updateWebhookSchema,
} from './webhooks.schemas';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
@RequirePermissions('webhook:manage')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints' })
  list(@CurrentUser() user: AuthUser) {
    return this.webhooks.list(user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWebhookSchema)) dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(user.tenantId, dto);
  }

  // Declared before :id routes so "secret" is not parsed as an endpoint id.
  @Get('secret')
  @ApiOperation({ summary: 'Reveal the tenant webhook signing secret' })
  getSecret(@CurrentUser() user: AuthUser) {
    return this.webhooks.getSecret(user.tenantId);
  }

  @Post('secret/rotate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the signing secret (old signatures stop verifying)' })
  rotateSecret(@CurrentUser() user: AuthUser) {
    return this.webhooks.rotateSecret(user.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a webhook endpoint' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a webhook endpoint (its delivery log goes with it)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(user.tenantId, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Delivery log for an endpoint (attempts, status, next retry)' })
  deliveries(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deliveriesQuerySchema)) query: DeliveriesQuery,
  ) {
    return this.webhooks.deliveries(user.tenantId, id, query);
  }

  @Post(':id/ping')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a signed test event to this endpoint' })
  ping(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.ping(user.tenantId, id);
  }
}
