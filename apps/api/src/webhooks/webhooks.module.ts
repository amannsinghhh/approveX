import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, OutboxService],
  exports: [OutboxService],
})
export class WebhooksModule {}
