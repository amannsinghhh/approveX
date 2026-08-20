import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { ApprovalTokensController } from './approval-tokens.controller';
import { ApprovalTokensService } from './approval-tokens.service';

// PrismaModule, RedisModule and AuditModule are @Global, so the only local
// dependency to wire is the request engine (for the actual approve/reject).
@Module({
  imports: [RequestsModule],
  controllers: [ApprovalTokensController],
  providers: [ApprovalTokensService],
  exports: [ApprovalTokensService],
})
export class ApprovalTokensModule {}
