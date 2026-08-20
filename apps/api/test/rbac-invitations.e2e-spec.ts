import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

describe('RBAC + invitations (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let viewerRoleId: string;
  let viewerToken: string;
  let viewerUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'rbac');
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin creates a limited role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set(auth(admin.accessToken))
      .send({ name: 'Viewer', description: 'Audit only', permissionKeys: ['audit:view'] })
      .expect(201);
    viewerRoleId = res.body.id;
    expect(res.body.permissions).toEqual(['audit:view']);
  });

  it('invitation flow: invite → accept → login', async () => {
    const email = `${unique('viewer')}@example.com`;
    const invite = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set(auth(admin.accessToken))
      .send({ email, roleIds: [viewerRoleId] })
      .expect(201);
    expect(invite.body.token).toBeTruthy(); // shown exactly once

    const accepted = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.token, name: 'Vik', password: 'password-123' })
      .expect(201);
    viewerUserId = accepted.body.user.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password-123' })
      .expect(200);
    viewerToken = login.body.accessToken;

    // Re-accepting the same token must fail
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.token, name: 'Again', password: 'password-123' })
      .expect(400);
  });

  it('permission guard: viewer can read audit but cannot manage members', async () => {
    await request(app.getHttpServer()).get('/api/v1/audit').set(auth(viewerToken)).expect(200);

    await request(app.getHttpServer()).get('/api/v1/users').set(auth(viewerToken)).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set(auth(viewerToken))
      .send({ name: 'Sneaky', permissionKeys: ['member:manage'] })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set(auth(viewerToken))
      .send({ email: 'x@example.com', roleIds: [viewerRoleId] })
      .expect(403);
  });

  it('admin can change a user’s roles and the change takes effect', async () => {
    const adminRole = (
      await request(app.getHttpServer()).get('/api/v1/roles').set(auth(admin.accessToken))
    ).body.items.find((role: { name: string }) => role.name === 'Admin');

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${viewerUserId}`)
      .set(auth(admin.accessToken))
      .send({ roleIds: [adminRole.id] })
      .expect(200);

    // Viewer now holds member:manage
    await request(app.getHttpServer()).get('/api/v1/users').set(auth(viewerToken)).expect(200);
  });

  it('deactivated users are locked out', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${viewerUserId}`)
      .set(auth(admin.accessToken))
      .send({ status: 'deactivated' })
      .expect(200);

    await request(app.getHttpServer()).get('/api/v1/users').set(auth(viewerToken)).expect(401);
  });

  it('self-deactivation is blocked', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${admin.userId}`)
      .set(auth(admin.accessToken))
      .send({ status: 'deactivated' })
      .expect(400);
  });

  it('system role cannot be modified or deleted', async () => {
    const adminRole = (
      await request(app.getHttpServer()).get('/api/v1/roles').set(auth(admin.accessToken))
    ).body.items.find((role: { name: string }) => role.name === 'Admin');

    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${adminRole.id}`)
      .set(auth(admin.accessToken))
      .send({ name: 'Renamed' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${adminRole.id}`)
      .set(auth(admin.accessToken))
      .expect(403);
  });

  it('revoked invitations cannot be accepted', async () => {
    const email = `${unique('revoked')}@example.com`;
    const invite = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set(auth(admin.accessToken))
      .send({ email, roleIds: [viewerRoleId] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/invitations/${invite.body.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.token, name: 'Late', password: 'password-123' })
      .expect(400);
  });
});
