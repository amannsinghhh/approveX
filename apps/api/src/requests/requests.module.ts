import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DelegationsController } from './delegations.controller';
import { RequestEngineService } from './request-engine.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [WebhooksModule],
  controllers: [RequestsController, DelegationsController],
  providers: [RequestEngineService, RequestsService],
  exports: [RequestEngineService, RequestsService],
})
export class RequestsModule {}
