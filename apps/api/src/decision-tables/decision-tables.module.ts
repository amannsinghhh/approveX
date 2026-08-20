import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DecisionTablesController } from './decision-tables.controller';
import { DecisionTablesService } from './decision-tables.service';

@Module({
  imports: [RulesModule],
  controllers: [DecisionTablesController],
  providers: [DecisionTablesService],
})
export class DecisionTablesModule {}
