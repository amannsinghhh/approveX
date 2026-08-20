import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';

@Module({
  imports: [InvitationsModule],
  controllers: [AuthController],
  providers: [AuthService, OidcService],
})
export class AuthModule {}
