import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

const simpleAst = (threshold: number) => ({
  operator: 'AND',
  children: [{ field: 'amount', operator: '>', value: threshold }],
});

describe('Rules + fields (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'rules');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('field registry', () => {
    let fieldId: string;

    it('creates, lists, updates, deletes fields', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/fields')
        .set(auth(admin.accessToken))
        .send({ name: 'amount', type: 'number', description: 'Payment amount in paise' })
        .expect(201);
      fieldId = created.body.id;

      await request(app.getHttpServer())
        .post('/api/v1/fields')
        .set(auth(admin.accessToken))
        .send({ name: 'amount', type: 'string' })
        .expect(409); // duplicate name

      const list = await request(app.getHttpServer())
        .get('/api/v1/fields')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(list.body.items.map((f: { name: string }) => f.name)).toContain('amount');

      await request(app.getHttpServer())
        .patch(`/api/v1/fields/${fieldId}`)
        .set(auth(admin.accessToken))
        .send({ description: 'INR amount' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/fields/${fieldId}`)
        .set(auth(admin.accessToken))
        .expect(200);
    });

    it('rejects invalid field names', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/fields')
        .set(auth(admin.accessToken))
        .send({ name: '1bad name;', type: 'string' })
        .expect(400);
    });
  });

  describe('rule lifecycle', () => {
    let ruleId: string;

    it('creates a draft rule with version 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Payments above 1L ${unique('r')}`,
          context: 'PAYMENT_APPROVAL',
          conditionAst: simpleAst(100000),
          priority: 10,
        })
        .expect(201);
      ruleId = res.body.id;
      expect(res.body.status).toBe('draft');
      expect(res.body.latestVersion.version).toBe(1);
      expect(res.body.latestVersion.publishedAt).toBeNull();
    });

    it('rejects malformed ASTs with per-node issues', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Broken ${unique('r')}`,
          context: 'PAYMENT_APPROVAL',
          conditionAst: { operator: 'NOT', children: [simpleAst(1), simpleAst(2)] },
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('exactly one child');
    });

    it('rejects ReDoS-prone regex patterns at authoring time', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Evil regex ${unique('r')}`,
          context: 'PAYMENT_APPROVAL',
          conditionAst: { field: 'ref', operator: 'MATCHES_REGEX', value: '(a+)+$' },
        })
        .expect(400);
    });

    it('publishes the draft, making it immutable at the database level', async () => {
      const published = await request(app.getHttpServer())
        .post(`/api/v1/rules/${ruleId}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(published.body.version).toBe(1);
      expect(published.body.publishedAt).not.toBeNull();

      // Even the owner connection cannot mutate a published version.
      const prisma = app.get(PrismaService);
      await expect(
        prisma.ruleVersion.update({
          where: { id: published.body.id },
          data: { priority: 1 },
        }),
      ).rejects.toThrow(/immutable/);

      // Publishing again without a new draft is a conflict.
      await request(app.getHttpServer())
        .post(`/api/v1/rules/${ruleId}/publish`)
        .set(auth(admin.accessToken))
        .expect(409);
    });

    it('editing a published rule creates draft v2; publishing bumps currentVersion', async () => {
      const draft = await request(app.getHttpServer())
        .put(`/api/v1/rules/${ruleId}/draft`)
        .set(auth(admin.accessToken))
        .send({ conditionAst: simpleAst(500000), priority: 5 })
        .expect(200);
      expect(draft.body.version).toBe(2);
      expect(draft.body.publishedAt).toBeNull();

      // Draft edits are allowed (still unpublished)
      await request(app.getHttpServer())
        .put(`/api/v1/rules/${ruleId}/draft`)
        .set(auth(admin.accessToken))
        .send({ conditionAst: simpleAst(600000), priority: 5 })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/rules/${ruleId}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(detail.body.currentVersion).toBe(2);
      expect(detail.body.versions).toHaveLength(2);
      // v1 is untouched
      const v1 = detail.body.versions.find((v: { version: number }) => v.version === 1);
      expect(v1.conditionAst.children[0].value).toBe(100000);
    });

    it('published rules cannot be hard-deleted, only archived', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/rules/${ruleId}`)
        .set(auth(admin.accessToken))
        .expect(409);

      await request(app.getHttpServer())
        .post(`/api/v1/rules/${ruleId}/archive`)
        .set(auth(admin.accessToken))
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/v1/rules/${ruleId}/draft`)
        .set(auth(admin.accessToken))
        .send({ conditionAst: simpleAst(1) })
        .expect(409); // archived rules are frozen
    });

    it('never-published rules can be deleted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Throwaway ${unique('r')}`,
          context: 'PAYMENT_APPROVAL',
          conditionAst: simpleAst(1),
        })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/rules/${res.body.id}`)
        .set(auth(admin.accessToken))
        .expect(200);
    });

    it('publish requires rule:publish; drafting requires rule:create', async () => {
      // Author role: can draft but not publish
      const roleRes = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set(auth(admin.accessToken))
        .send({ name: 'Author', permissionKeys: ['rule:create'] })
        .expect(201);
      const invite = await request(app.getHttpServer())
        .post('/api/v1/invitations')
        .set(auth(admin.accessToken))
        .send({ email: `${unique('author')}@example.com`, roleIds: [roleRes.body.id] })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invitation')
        .send({ token: invite.body.token, name: 'Author', password: 'password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: invite.body.email, password: 'password-123' })
        .expect(200);
      const authorToken = login.body.accessToken;

      const rule = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(authorToken))
        .send({
          name: `Author draft ${unique('r')}`,
          context: 'PAYMENT_APPROVAL',
          conditionAst: simpleAst(1),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/rules/${rule.body.id}/publish`)
        .set(auth(authorToken))
        .expect(403);
    });
  });

  describe('field metadata (B.2) round-trip', () => {
    it('persists unit/precision/source/defaultIfMissing/enumValues', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/fields')
        .set(auth(admin.accessToken))
        .send({
          name: `spend_${unique('f').replace(/[^a-z0-9_]/gi, '_')}`,
          type: 'number',
          unit: 'currency:INR',
          precision: 2,
          source: 'payload',
          defaultIfMissing: 0,
          nullable: false,
        })
        .expect(201);
      expect(created.body.unit).toBe('currency:INR');
      expect(created.body.precision).toBe(2);
      expect(created.body.defaultIfMissing).toBe(0);
      expect(created.body.nullable).toBe(false);

      const enumField = await request(app.getHttpServer())
        .post('/api/v1/fields')
        .set(auth(admin.accessToken))
        .send({
          name: `tier_${unique('f').replace(/[^a-z0-9_]/gi, '_')}`,
          type: 'string',
          enumValues: ['low', 'high'],
        })
        .expect(201);
      expect(enumField.body.enumValues).toEqual(['low', 'high']);
    });
  });

  describe('fallback catch-all (B.3 #15)', () => {
    const context = `FALLBACK_${unique('c').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;

    it('reports no fallback until a catch-all is published, then reports it', async () => {
      // A normal rule in the context — not a catch-all.
      const normal = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({ name: `Normal ${unique('r')}`, context, conditionAst: simpleAst(500000), priority: 10 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/rules/${normal.body.id}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);

      const before = await request(app.getHttpServer())
        .get('/api/v1/rules/contexts/health')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(before.body.contexts.find((c: { context: string }) => c.context === context)).toMatchObject(
        { publishedRules: 1, hasFallback: false },
      );

      // A catch-all rule (root empty-AND) at the lowest priority.
      const fallback = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Catch-all ${unique('r')}`,
          context,
          conditionAst: { operator: 'AND', children: [] },
          priority: 1000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/rules/${fallback.body.id}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/v1/rules/contexts/health')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(after.body.contexts.find((c: { context: string }) => c.context === context)).toMatchObject(
        { publishedRules: 2, hasFallback: true, fallbackRuleId: fallback.body.id },
      );
    });
  });
});
