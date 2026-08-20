import { Module } from '@nestjs/common';
import { EvaluateModule } from '../evaluate/evaluate.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [EvaluateModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
