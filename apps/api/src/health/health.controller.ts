import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ description: 'Service is up' })
  health(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
