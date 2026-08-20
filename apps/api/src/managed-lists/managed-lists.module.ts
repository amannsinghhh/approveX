import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { ManagedListsController } from './managed-lists.controller';
import { ManagedListsService } from './managed-lists.service';

@Module({
  imports: [RulesModule],
  controllers: [ManagedListsController],
  providers: [ManagedListsService],
})
export class ManagedListsModule {}
