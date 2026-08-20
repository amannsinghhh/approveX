import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

// The spec's example: amount x department → workflow
const specTable = () => ({
  name: `Payment routing ${unique('dt')}`,
  context: 'PAYMENT_APPROVAL',
  hitPolicy: 'first',
  columns: [{ field: 'amount' }, { field: 'department' }],
  rows: [
    { cells: ['< 50000', '*'], output: { workflow: 'MANAGER_ONLY' } },
    { cells: ['50000..500000', 'Finance'], output: { workflow: 'MANAGER_FINANCE' } },
    { cells: ['> 500000', '*'], output: { workflow: 'MANAGER_FINANCE_CFO' } },
  ],
});

describe('Decision tables (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let tableId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'dtable');
    // amount is registered numeric so "50000..500000" cells parse as numbers
    await request(app.getHttpServer())
      .post('/api/v1/fields')
      .set(auth(admin.accessToken))
      .send({ name: 'amount', type: 'number' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a draft decision table', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/decision-tables')
      .set(auth(admin.accessToken))
      .send(specTable())
      .expect(201);
    tableId = res.body.id;
    expect(res.body.status).toBe('draft');
    expect(res.body.latestVersion.version).toBe(1);
    expect(res.body.latestVersion.hitPolicy).toBe('first');
  });

  it('rejects malformed tables with pointed issues', async () => {
    const bad = specTable();
    bad.rows[0]!.cells = ['< abc', '*']; // not a number for a numeric column
    const res = await request(app.getHttpServer())
      .post('/api/v1/decision-tables')
      .set(auth(admin.accessToken))
      .send({ ...bad, name: `Bad ${unique('dt')}` })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('rows[0].cells[0]');

    const wrongArity = specTable();
    wrongArity.rows[0]!.cells = ['< 50000'];
    await request(app.getHttpServer())
      .post('/api/v1/decision-tables')
      .set(auth(admin.accessToken))
      .send({ ...wrongArity, name: `Arity ${unique('dt')}` })
      .expect(400);
  });

  it('tests the spec example end to end (hit policy first)', async () => {
    const run = async (data: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/decision-tables/${tableId}/test`)
        .set(auth(admin.accessToken))
        .send({ data })
        .expect(200);
      return res.body;
    };

    expect((await run({ amount: 10000, department: 'HR' })).outputs).toEqual([
      { workflow: 'MANAGER_ONLY' },
    ]);
    expect((await run({ amount: 200000, department: 'Finance' })).outputs).toEqual([
      { workflow: 'MANAGER_FINANCE' },
    ]);
    expect((await run({ amount: '900000', department: 'HR' })).outputs).toEqual([
      { workflow: 'MANAGER_FINANCE_CFO' }, // numeric string coerced via registry
    ]);
    const noMatch = await run({ amount: 200000, department: 'HR' });
    expect(noMatch.anyMatch).toBe(false);
    // All rows evaluated with traces regardless of matching
    expect(noMatch.rows).toHaveLength(3);
    expect(noMatch.rows[0].trace.length).toBeGreaterThan(0);
  });

  it('publish freezes the version at the database level', async () => {
    const published = await request(app.getHttpServer())
      .post(`/api/v1/decision-tables/${tableId}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(published.body.publishedAt).not.toBeNull();

    const prisma = app.get(PrismaService);
    await expect(
      prisma.decisionTableVersion.update({
        where: { id: published.body.id },
        data: { hitPolicy: 'all' },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it('editing after publish creates draft v2', async () => {
    const body = specTable();
    const draft = await request(app.getHttpServer())
      .put(`/api/v1/decision-tables/${tableId}/draft`)
      .set(auth(admin.accessToken))
      .send({ columns: body.columns, rows: body.rows, hitPolicy: 'all' })
      .expect(200);
    expect(draft.body.version).toBe(2);
    expect(draft.body.publishedAt).toBeNull();

    // test endpoint uses the head version (v2, hit policy all)
    const res = await request(app.getHttpServer())
      .post(`/api/v1/decision-tables/${tableId}/test`)
      .set(auth(admin.accessToken))
      .send({ data: { amount: 10000, department: 'HR' } })
      .expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.hitPolicy).toBe('all');
  });

  it('published tables cannot be deleted; draft-only tables can', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/decision-tables/${tableId}`)
      .set(auth(admin.accessToken))
      .expect(409);

    const fresh = await request(app.getHttpServer())
      .post('/api/v1/decision-tables')
      .set(auth(admin.accessToken))
      .send({ ...specTable(), name: `Throwaway ${unique('dt')}` })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/decision-tables/${fresh.body.id}`)
      .set(auth(admin.accessToken))
      .expect(200);
  });

  describe('hit policy unique (overlap detection)', () => {
    it('rejects a table whose rows overlap under unique, naming the rows', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/decision-tables')
        .set(auth(admin.accessToken))
        .send({
          name: `Overlapping ${unique('dt')}`,
          context: 'PAYMENT_APPROVAL',
          hitPolicy: 'unique',
          columns: [{ field: 'amount' }],
          // Any amount > 200 satisfies both rows → not unique.
          rows: [
            { cells: ['> 100'], output: { workflow: 'A' } },
            { cells: ['> 200'], output: { workflow: 'B' } },
          ],
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/overlap/i);
    });

    it('accepts disjoint rows under unique and publishes', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/decision-tables')
        .set(auth(admin.accessToken))
        .send({
          name: `Disjoint ${unique('dt')}`,
          context: 'PAYMENT_APPROVAL',
          hitPolicy: 'unique',
          columns: [{ field: 'amount' }],
          rows: [
            { cells: ['< 100'], output: { workflow: 'LOW' } },
            { cells: ['> 200'], output: { workflow: 'HIGH' } },
          ],
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/decision-tables/${created.body.id}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);
    });
  });

  describe('hit policy best (highest row priority wins)', () => {
    it('fires the single highest-priority matched row', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/decision-tables')
        .set(auth(admin.accessToken))
        .send({
          name: `Best ${unique('dt')}`,
          context: 'PAYMENT_APPROVAL',
          hitPolicy: 'best',
          columns: [{ field: 'amount' }, { field: 'department' }],
          rows: [
            { cells: ['> 100', '*'], output: { workflow: 'GENERIC' }, priority: 1 },
            { cells: ['> 100', 'Finance'], output: { workflow: 'FINANCE' }, priority: 5 },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/decision-tables/${created.body.id}/test`)
        .set(auth(admin.accessToken))
        .send({ data: { amount: 500, department: 'Finance' } })
        .expect(200);
      // Both rows match; best fires the higher-priority row (5 > 1).
      expect(res.body.outputs).toEqual([{ workflow: 'FINANCE' }]);
    });
  });
});
