import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';

@Module({
  imports: [RulesModule],
  controllers: [FieldsController],
  providers: [FieldsService],
})
export class FieldsModule {}
