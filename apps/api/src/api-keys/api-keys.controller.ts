import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CreateApiKeyDto } from './api-keys.schemas';
import { createApiKeySchema } from './api-keys.schemas';
import { ApiKeysService } from './api-keys.service';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
@RequirePermissions('apikey:manage')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys (prefixes only — plaintext is never stored)' })
  list(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create an API key — the plaintext key is returned exactly once' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke an API key (immediate, irreversible)' })
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(user.tenantId, id);
  }
}
