import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, signupTenant, unique } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up a tenant and returns tokens + admin identity', async () => {
    const slug = unique('acme').toLowerCase();
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'Acme Corp',
        slug,
        name: 'Asha',
        email: `${slug}@example.com`,
        password: 'password-123',
      })
      .expect(201);

    expect(res.body.tenant.slug).toBe(slug);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(auth(res.body.accessToken))
      .expect(200);
    expect(me.body.roles.map((r: { name: string }) => r.name)).toContain('Admin');
    // First user holds the full permission catalog
    expect(me.body.permissions).toEqual([
      'apikey:manage',
      'audit:view',
      'member:manage',
      'request:approve',
      'rule:create',
      'rule:publish',
      'webhook:manage',
      'workflow:create',
      'workflow:publish',
    ]);
  });

  it('rejects a signup body with unknown fields (zod strict)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'Evil Corp',
        name: 'Mallory',
        email: `${unique('evil')}@example.com`,
        password: 'password-123',
        isSuperAdmin: true,
      })
      .expect(400);
  });

  it('rejects duplicate slug and duplicate email with 409', async () => {
    const first = await signupTenant(app, 'dup');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'Copy',
        slug: first.slug,
        name: 'X',
        email: `${unique('other')}@example.com`,
        password: 'password-123',
      })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ tenantName: 'Copy2', name: 'X', email: first.email, password: 'password-123' })
      .expect(409);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    const tenant = await signupTenant(app, 'login');

    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.email, password: 'password-123' })
      .expect(200);
    expect(ok.body.accessToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rotates refresh tokens: old token is dead after refresh', async () => {
    const tenant = await signupTenant(app, 'rotate');

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tenant.refreshToken })
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body.refreshToken).not.toBe(tenant.refreshToken);

    // Replaying the consumed token must fail
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tenant.refreshToken })
      .expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const tenant = await signupTenant(app, 'logout');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(auth(tenant.accessToken))
      .send({ refreshToken: tenant.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tenant.refreshToken })
      .expect(401);
  });

  it('rejects requests without a token and with a garbage token', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    await request(app.getHttpServer()).get('/api/v1/me').set(auth('not-a-jwt')).expect(401);
  });
});
