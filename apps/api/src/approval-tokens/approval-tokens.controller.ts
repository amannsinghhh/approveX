import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators';
import { ApprovalTokensService } from './approval-tokens.service';

export const consumeTokenSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(2000).optional(),
});
export type ConsumeTokenDto = z.infer<typeof consumeTokenSchema>;

/**
 * Public, unauthenticated landing surface for no-login approval links. The raw
 * token in the URL is the only credential — `@Public()` skips the JWT guard,
 * and the service rate-limits every hit. Both handlers always return 200 with a
 * `state` discriminator so the landing page can render a friendly message for
 * expired / already-handled / over-ceiling links instead of a bare error.
 */
@Public()
@Controller('public/approvals')
export class ApprovalTokensController {
  constructor(private readonly tokens: ApprovalTokensService) {}

  @Get(':token')
  preview(@Param('token') token: string, @Ip() ip: string) {
    return this.tokens.preview(token, { ip });
  }

  @Post(':token')
  @HttpCode(200)
  consume(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(consumeTokenSchema)) dto: ConsumeTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.tokens.consume(token, dto.action, { ip, userAgent, comment: dto.comment });
  }
}
