import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { ApiKeyScopes, CurrentUser } from '../common/decorators';
import { RateLimited } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { EvaluateDto } from './evaluate.schemas';
import { evaluateSchema } from './evaluate.schemas';
import { EvaluateService } from './evaluate.service';

@ApiTags('evaluate')
@ApiBearerAuth()
@Controller('evaluate')
export class EvaluateController {
  constructor(private readonly evaluateService: EvaluateService) {}

  @Post()
  @HttpCode(200)
  @ApiKeyScopes('evaluate')
  @RateLimited()
  @ApiOperation({
    summary: 'Evaluate a payload against the published rules of a context',
    description:
      'mode "dry_run" returns the matched rule, full trace, and conflict-resolution ' +
      'ranking with zero side effects. mode "execute" creates a request and starts ' +
      'the bound workflow. Idempotency-Key replays return the original response.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  evaluate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(evaluateSchema)) dto: EvaluateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    return this.evaluateService.evaluate(user.tenantId, user.userId, dto, idempotencyKey, ip);
  }
}
