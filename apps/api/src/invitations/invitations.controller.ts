import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CreateInvitationDto } from './invitations.schemas';
import { createInvitationSchema } from './invitations.schemas';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
@RequirePermissions('member:manage')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @ApiOperation({ summary: 'Invite a user (returns the invitation token exactly once)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInvitationSchema)) dto: CreateInvitationDto,
  ) {
    return this.invitations.create(user.tenantId, user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List invitations' })
  list(@CurrentUser() user: AuthUser) {
    return this.invitations.list(user.tenantId);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(user.tenantId, id);
  }
}
