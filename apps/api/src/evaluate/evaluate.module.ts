import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { RulesModule } from '../rules/rules.module';
import { AggregateProviderService } from './aggregate-provider.service';
import { EvaluateController } from './evaluate.controller';
import { EvaluateService } from './evaluate.service';
import { LookupProviderService } from './lookup-provider.service';

@Module({
  imports: [RulesModule, RequestsModule],
  controllers: [EvaluateController],
  providers: [EvaluateService, AggregateProviderService, LookupProviderService],
  exports: [EvaluateService],
})
export class EvaluateModule {}
