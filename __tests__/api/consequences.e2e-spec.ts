import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createRole, createTestApp, signupTenant, unique } from './utils';

/**
 * A.1 #3 — consequence previews. Deleting a role (or deactivating its last
 * member) must show what stalls, and role deletion must refuse while
 * published workflows still route to it.
 */
describe('Consequence previews (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let approverRoleId: string;
  let escalationRoleId: string;
  let workflowId: string;

  const graphFor = (roleId: string, escalateToRoleId?: string) => ({
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'approve',
        type: 'approval',
        label: 'Approver sign-off',
        config: { roleId, quorum: 'any', ...(escalateToRoleId ? { escalateToRoleId } : {}) },
      },
      { id: 'done', type: 'auto_approve' },
    ],
    edges: [
      { from: 'start', to: 'approve' },
      { from: 'approve', to: 'done' },
    ],
  });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'conseq');
    approverRoleId = await createRole(app, admin.accessToken, 'Approvers');
    escalationRoleId = await createRole(app, admin.accessToken, 'Escalation Desk');

    const created = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({
        name: `Conseq ${unique('wf')}`,
        graph: graphFor(approverRoleId, escalationRoleId),
      })
      .expect(201);
    workflowId = created.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/workflows/${workflowId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET roles/:id/consequences lists workflows routing to the role', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/roles/${approverRoleId}/consequences`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(res.body.deletable).toBe(false);
    expect(res.body.workflows).toHaveLength(1);
    expect(res.body.workflows[0].id).toBe(workflowId);
    expect(res.body.workflows[0].nodes[0]).toEqual({ id: 'approve', label: 'Approver sign-off' });
  });

  it('escalation targets count as references too', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/roles/${escalationRoleId}/consequences`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(res.body.deletable).toBe(false);
    expect(res.body.workflows.map((wf: { id: string }) => wf.id)).toEqual([workflowId]);
  });

  it('DELETE refuses (409) while a published workflow routes to the role', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/roles/${approverRoleId}`)
      .set(auth(admin.accessToken))
      .expect(409);
    expect(res.body.message).toMatch(/still in use/);
    expect(res.body.workflows).toHaveLength(1);
  });

  it('draft-only references do not block deletion (publish will catch them)', async () => {
    const tempRoleId = await createRole(app, admin.accessToken, 'Temp Only');
    await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `Draft ${unique('wf')}`, graph: graphFor(tempRoleId) })
      .expect(201); // never published

    const preview = await request(app.getHttpServer())
      .get(`/api/v1/roles/${tempRoleId}/consequences`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(preview.body.workflows).toEqual([]);
    expect(preview.body.deletable).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${tempRoleId}`)
      .set(auth(admin.accessToken))
      .expect(200);
  });

  it('user consequences flag roles where they are the sole active approver', async () => {
    // Give the admin the Approvers role (keeping their system Admin role).
    const roles = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set(auth(admin.accessToken))
      .expect(200);
    const adminRole = roles.body.items.find((role: { isSystem: boolean }) => role.isSystem);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${admin.userId}`)
      .set(auth(admin.accessToken))
      .send({ roleIds: [adminRole.id, approverRoleId] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/users/${admin.userId}/consequences`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(res.body.safeToDeactivate).toBe(false);
    const stalled = res.body.soleApproverRoles.map((role: { id: string }) => role.id);
    expect(stalled).toContain(approverRoleId);
    // Admin system role isn't referenced by any workflow, so it is not a consequence.
    expect(stalled).not.toContain(adminRole.id);
  });
});
