import { createPublicKey, createVerify, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '../common/env';

/**
 * Google + Microsoft OIDC login (authorization-code flow). Env-gated: a
 * provider only exists when its OIDC_<PROVIDER>_CLIENT_ID/SECRET are set.
 * SSO signs an EXISTING active user in by verified email — it never
 * provisions accounts (invitations are the only way in, MVP decision).
 *
 * id_token verification is done directly with node:crypto (RS256 against the
 * provider's JWKS): jose v5+ is ESM-only and this API compiles to CJS.
 */

export type OidcProviderId = 'google' | 'microsoft';

interface ProviderConfig {
  id: OidcProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Exact issuer, or prefix when the issuer embeds a directory tenant (Microsoft). */
  issuer: { exact?: string; prefix?: string };
}

interface StatePayload {
  p: OidcProviderId;
  n: string; // nonce, echoed back in the id_token
}

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
  [key: string]: unknown;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [key: string]: unknown;
}

const base64UrlToBuffer = (value: string): Buffer => Buffer.from(value, 'base64url');

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  /** JWKS cache per provider: keys change rarely, refetch hourly. */
  private readonly jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

  constructor(private readonly jwt: JwtService) {}

  private provider(id: string): ProviderConfig {
    const config = this.providers().find((candidate) => candidate.id === id);
    if (!config) throw new NotFoundException(`SSO provider "${id}" is not configured`);
    return config;
  }

  providers(): ProviderConfig[] {
    const result: ProviderConfig[] = [];
    const google = {
      clientId: process.env.OIDC_GOOGLE_CLIENT_ID,
      clientSecret: process.env.OIDC_GOOGLE_CLIENT_SECRET,
    };
    if (google.clientId && google.clientSecret) {
      result.push({
        id: 'google',
        label: 'Google',
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        issuer: { exact: 'https://accounts.google.com' },
      });
    }
    const microsoft = {
      clientId: process.env.OIDC_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.OIDC_MICROSOFT_CLIENT_SECRET,
    };
    if (microsoft.clientId && microsoft.clientSecret) {
      const directory = process.env.OIDC_MICROSOFT_TENANT ?? 'common';
      result.push({
        id: 'microsoft',
        label: 'Microsoft',
        clientId: microsoft.clientId,
        clientSecret: microsoft.clientSecret,
        authorizationEndpoint: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/authorize`,
        tokenEndpoint: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/token`,
        jwksUri: `https://login.microsoftonline.com/${directory}/discovery/v2.0/keys`,
        // With the multi-tenant "common" endpoint the issuer embeds the
        // signed-in user's directory id — validate the prefix.
        issuer: { prefix: 'https://login.microsoftonline.com/' },
      });
    }
    return result;
  }

  listProviders(): { providers: { id: string; label: string }[] } {
    return { providers: this.providers().map(({ id, label }) => ({ id, label })) };
  }

  private redirectUri(provider: ProviderConfig): string {
    return `${env.apiPublicUrl}/api/v1/auth/oidc/${provider.id}/callback`;
  }

  /** Authorization URL with a short-lived signed state (CSRF + nonce carrier). */
  async startUrl(providerId: string): Promise<string> {
    const provider = this.provider(providerId);
    const state: StatePayload = { p: provider.id, n: randomUUID() };
    const stateJwt = await this.jwt.signAsync(state, {
      secret: env.jwtAccessSecret,
      expiresIn: 600,
    });
    const params = new URLSearchParams({
      client_id: provider.clientId,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: this.redirectUri(provider),
      state: stateJwt,
      nonce: state.n,
      prompt: 'select_account',
    });
    return `${provider.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Callback half: state check, code exchange, id_token verification.
   * Returns the verified email — AuthService turns it into a session.
   */
  async handleCallback(providerId: string, code: string, stateJwt: string): Promise<string> {
    const provider = this.provider(providerId);

    let state: StatePayload;
    try {
      state = await this.jwt.verifyAsync<StatePayload>(stateJwt, { secret: env.jwtAccessSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired SSO state');
    }
    if (state.p !== provider.id) throw new UnauthorizedException('SSO state/provider mismatch');

    const tokenRes = await fetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        redirect_uri: this.redirectUri(provider),
      }),
    });
    if (!tokenRes.ok) {
      this.logger.warn(`${provider.id} token exchange failed: ${await tokenRes.text()}`);
      throw new UnauthorizedException('SSO code exchange failed');
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new UnauthorizedException('Provider returned no id_token');

    const claims = await this.verifyIdToken(provider, tokens.id_token);
    if (claims.nonce !== state.n) throw new UnauthorizedException('SSO nonce mismatch');

    const email = claims.email ?? claims.preferred_username;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new BadRequestException('The identity provider returned no usable email');
    }
    // Google sends email_verified; treat absent (Microsoft) as verified —
    // Entra accounts are directory-managed.
    if (claims.email_verified === false || claims.email_verified === 'false') {
      throw new UnauthorizedException('Email is not verified with the identity provider');
    }
    return email.toLowerCase();
  }

  private async verifyIdToken(provider: ProviderConfig, idToken: string): Promise<IdTokenClaims> {
    const [headerPart, payloadPart, signaturePart] = idToken.split('.');
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new UnauthorizedException('Malformed id_token');
    }
    const header = JSON.parse(base64UrlToBuffer(headerPart).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256') throw new UnauthorizedException('Unsupported id_token algorithm');

    const jwk = await this.findKey(provider, header.kid);
    const verifier = createVerify('RSA-SHA256').update(`${headerPart}.${payloadPart}`);
    const valid = verifier.verify(
      createPublicKey({ key: jwk as never, format: 'jwk' }),
      base64UrlToBuffer(signaturePart),
    );
    if (!valid) throw new UnauthorizedException('id_token signature verification failed');

    const claims = JSON.parse(base64UrlToBuffer(payloadPart).toString('utf8')) as IdTokenClaims;

    if (!claims.exp || claims.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('id_token is expired');
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(provider.clientId)) {
      throw new UnauthorizedException('id_token audience mismatch');
    }
    const issuer = claims.iss ?? '';
    const issuerOk = provider.issuer.exact
      ? issuer === provider.issuer.exact
      : issuer.startsWith(provider.issuer.prefix ?? ' ');
    if (!issuerOk) throw new UnauthorizedException('id_token issuer mismatch');

    return claims;
  }

  private async findKey(provider: ProviderConfig, kid: string | undefined): Promise<Jwk> {
    const cached = this.jwksCache.get(provider.id);
    let keys = cached && Date.now() - cached.fetchedAt < 3600_000 ? cached.keys : null;
    if (!keys) {
      const res = await fetch(provider.jwksUri);
      if (!res.ok) throw new UnauthorizedException('Could not fetch provider JWKS');
      keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
      this.jwksCache.set(provider.id, { keys, fetchedAt: Date.now() });
    }
    const key = keys.find((candidate) => candidate.kid === kid);
    if (!key) throw new UnauthorizedException('id_token signing key not found in JWKS');
    return key;
  }
}
