import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../apps/api/src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

/** Unique-per-run values so specs never collide on unique columns. */
export const unique = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface SignedUpTenant {
  tenantId: string;
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  slug: string;
}

export async function signupTenant(app: INestApplication, label: string): Promise<SignedUpTenant> {
  const slug = unique(label).toLowerCase();
  const email = `${slug}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      tenantName: `Tenant ${label}`,
      slug,
      name: `Admin ${label}`,
      email,
      password: 'password-123',
    })
    .expect(201);
  return {
    tenantId: res.body.tenant.id,
    userId: res.body.user.id,
    email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    slug,
  };
}

export const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

export async function createRole(
  app: INestApplication,
  adminToken: string,
  name: string,
  permissionKeys: string[] = ['request:approve'],
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/roles')
    .set(auth(adminToken))
    .send({ name: `${name} ${unique('r')}`, permissionKeys })
    .expect(201);
  return res.body.id as string;
}

export interface TestUser {
  userId: string;
  email: string;
  token: string;
}

/** Invite → accept → login. The standard way to mint an approver in tests. */
export async function createUserWithRoles(
  app: INestApplication,
  adminToken: string,
  label: string,
  roleIds: string[],
): Promise<TestUser> {
  const invite = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set(auth(adminToken))
    .send({ email: `${unique(label)}@example.com`, roleIds })
    .expect(201);
  const accepted = await request(app.getHttpServer())
    .post('/api/v1/auth/accept-invitation')
    .send({ token: invite.body.token, name: label, password: 'password-123' })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: invite.body.email, password: 'password-123' })
    .expect(200);
  return { userId: accepted.body.user.id, email: invite.body.email, token: login.body.accessToken };
}
