import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
import type { SignedUpTenant } from './utils';
import { auth, createRole, createTestApp, signupTenant, unique } from './utils';

describe('Workflows (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let mgrRoleId: string;
  let finRoleId: string;

  const linearGraph = () => ({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'mgr', type: 'approval', config: { roleId: mgrRoleId, quorum: 'any' } },
      { id: 'fin', type: 'approval', config: { roleId: finRoleId, quorum: 'any' } },
      { id: 'done', type: 'auto_approve' },
    ],
    edges: [
      { from: 'start', to: 'mgr' },
      { from: 'mgr', to: 'fin' },
      { from: 'fin', to: 'done' },
    ],
  });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'wf');
    mgrRoleId = await createRole(app, admin.accessToken, 'Manager');
    finRoleId = await createRole(app, admin.accessToken, 'Finance');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and publishes a valid workflow; published version is frozen', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `Two tier ${unique('wf')}`, graph: linearGraph() })
      .expect(201);
    expect(created.body.latestVersion.rejectionPolicy).toBe('any_reject_kills');

    const published = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(published.body.publishedAt).not.toBeNull();

    const prisma = app.get(PrismaService);
    await expect(
      prisma.workflowVersion.update({
        where: { id: published.body.id },
        data: { rejectionPolicy: 'reject_returns_to_previous_step' },
      }),
    ).rejects.toThrow(/immutable/);

    // Editing creates v2
    const draft = await request(app.getHttpServer())
      .put(`/api/v1/workflows/${created.body.id}/draft`)
      .set(auth(admin.accessToken))
      .send({ graph: linearGraph(), rejectionPolicy: 'any_reject_kills' })
      .expect(200);
    expect(draft.body.version).toBe(2);
  });

  it('POST /workflows/validate surfaces pointed graph errors without saving', async () => {
    const graph = linearGraph();
    graph.edges.push({ from: 'fin', to: 'mgr' }); // cycle
    graph.nodes.push({
      id: 'island',
      type: 'approval',
      config: { roleId: mgrRoleId, quorum: 'any' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/workflows/validate')
      .set(auth(admin.accessToken))
      .send({ graph })
      .expect(200);
    expect(res.body.valid).toBe(false);
    const messages = res.body.issues.map((issue: { message: string }) => issue.message).join(' | ');
    expect(messages).toContain('Cycle detected');
  });

  it('rejects publishing a graph with an unknown role', async () => {
    const graph = linearGraph();
    (graph.nodes[1] as { config: { roleId: string } }).config.roleId =
      '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({ name: `Ghost role ${unique('wf')}`, graph })
      .expect(400);
  });

  it('rejects reject_returns_to_previous_step on non-linear graphs', async () => {
    const forked = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'mgr', type: 'approval', config: { roleId: mgrRoleId } },
        { id: 'fin', type: 'approval', config: { roleId: finRoleId } },
        { id: 'done', type: 'auto_approve' },
      ],
      edges: [
        { from: 'start', to: 'mgr' },
        { from: 'start', to: 'fin' },
        { from: 'mgr', to: 'done' },
        { from: 'fin', to: 'done' },
      ],
    };
    const res = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(admin.accessToken))
      .send({
        name: `Fork return ${unique('wf')}`,
        graph: forked,
        rejectionPolicy: 'reject_returns_to_previous_step',
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('linear');
  });

  it('workflow creation requires workflow:create', async () => {
    const viewerRole = await createRole(app, admin.accessToken, 'NoWf', ['audit:view']);
    const { createUserWithRoles } = await import('./utils');
    const viewer = await createUserWithRoles(app, admin.accessToken, 'viewer', [viewerRole]);
    await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set(auth(viewer.token))
      .send({ name: `Nope ${unique('wf')}`, graph: linearGraph() })
      .expect(403);
  });
});
