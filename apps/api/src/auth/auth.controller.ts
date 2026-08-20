import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Public } from '../common/decorators';
import { env } from '../common/env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InvitationsService } from '../invitations/invitations.service';
import type { AcceptInvitationDto, LoginDto, RefreshDto, SignupDto } from './auth.schemas';
import { acceptInvitationSchema, loginSchema, refreshSchema, signupSchema } from './auth.schemas';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
    private readonly oidc: OidcService,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create a tenant and its first (admin) user' })
  signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto, @Ip() ip: string) {
    return this.auth.signup(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email and password' })
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotation)' })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(user.userId, user.tenantId, dto);
  }

  @Public()
  @Get('oidc/providers')
  @ApiOperation({ summary: 'SSO providers enabled on this deployment (env-gated)' })
  oidcProviders() {
    return this.oidc.listProviders();
  }

  @Public()
  @Get('oidc/:provider/start')
  @ApiOperation({ summary: 'Redirect to the identity provider (Google/Microsoft)' })
  async oidcStart(@Param('provider') provider: string, @Res() res: Response): Promise<void> {
    res.redirect(await this.oidc.startUrl(provider));
  }

  @Public()
  @Get('oidc/:provider/callback')
  @ApiOperation({ summary: 'OIDC callback — verifies the id_token and signs the user in' })
  async oidcCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    // Tokens travel in the URL fragment: fragments never leave the browser
    // (no server logs, no Referer leakage), and the SPA strips them on load.
    const land = (fragment: string): void =>
      res.redirect(`${env.webAppUrl}/auth/callback#${fragment}`);
    if (providerError || !code || !state) {
      land(`error=${encodeURIComponent(providerError ?? 'missing_code')}`);
      return;
    }
    try {
      const email = await this.oidc.handleCallback(provider, code, state);
      const session = await this.auth.loginOidc(email, provider, ip);
      land(
        `access_token=${encodeURIComponent(session.accessToken)}` +
          `&refresh_token=${encodeURIComponent(session.refreshToken)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SSO login failed';
      land(`error=${encodeURIComponent(message)}`);
    }
  }

  @Public()
  @Post('accept-invitation')
  @ApiOperation({ summary: 'Accept an invitation and create the invited user' })
  acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) dto: AcceptInvitationDto,
    @Ip() ip: string,
  ) {
    return this.invitations.accept(dto, ip);
  }
}
