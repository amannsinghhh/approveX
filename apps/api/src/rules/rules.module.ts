import { Module } from '@nestjs/common';
import { RuleCacheService } from './rule-cache.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  controllers: [RulesController],
  providers: [RulesService, RuleCacheService],
  exports: [RuleCacheService],
})
export class RulesModule {}
