import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

const querySchema = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
  .strict();

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Tenant analytics: volumes, approval rate, decision time, SLA health' })
  summary(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(querySchema)) query: { days: number },
  ) {
    return this.analytics.summary(user.tenantId, query.days);
  }
}
