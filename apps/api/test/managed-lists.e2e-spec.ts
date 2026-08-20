import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

describe('Managed lists (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'lists');
  });

  afterAll(async () => {
    await app.close();
  });

  const createList = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/managed-lists').set(auth(admin.accessToken)).send(body);

  describe('CRUD', () => {
    it('creates, lists, updates, and deletes a managed list', async () => {
      const name = unique('Blocklist');
      const created = await createList({
        name,
        description: 'Sanctioned countries',
        values: ['CN', 'RU', 'KP'],
      }).expect(201);
      expect(created.body).toMatchObject({ name, description: 'Sanctioned countries' });
      expect(created.body.values).toEqual(['CN', 'RU', 'KP']);
      const listId = created.body.id as string;

      const listed = await request(app.getHttpServer())
        .get('/api/v1/managed-lists')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(listed.body.items.some((l: { id: string }) => l.id === listId)).toBe(true);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/managed-lists/${listId}`)
        .set(auth(admin.accessToken))
        .send({ values: ['CN', 'RU'] })
        .expect(200);
      expect(updated.body.values).toEqual(['CN', 'RU']);

      await request(app.getHttpServer())
        .delete(`/api/v1/managed-lists/${listId}`)
        .set(auth(admin.accessToken))
        .expect(200);

      const afterDelete = await request(app.getHttpServer())
        .get('/api/v1/managed-lists')
        .set(auth(admin.accessToken))
        .expect(200);
      expect(afterDelete.body.items.some((l: { id: string }) => l.id === listId)).toBe(false);
    });

    it('normalizes values: trims, drops whitespace-only, de-duplicates', async () => {
      const created = await createList({
        name: unique('Messy'),
        values: [' CN ', 'CN', '   ', 'RU'],
      }).expect(201);
      expect(created.body.values).toEqual(['CN', 'RU']);
    });

    it('rejects a duplicate name within the tenant with 409', async () => {
      const name = unique('Dupes');
      await createList({ name, values: ['a'] }).expect(201);
      await createList({ name, values: ['b'] }).expect(409);
    });

    it('rejects unknown fields and empty names (strict Zod)', async () => {
      await createList({ name: '', values: [] }).expect(400);
      await createList({ name: unique('X'), values: [], surprise: true }).expect(400);
    });

    it('404s on updating a non-existent list', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/managed-lists/00000000-0000-0000-0000-000000000000')
        .set(auth(admin.accessToken))
        .send({ values: ['z'] })
        .expect(404);
    });
  });

  describe('evaluation wiring (edit reflects WITHOUT republishing the rule)', () => {
    it('IN_LIST resolves against the managed list, and editing it changes the verdict', async () => {
      const context = `LIST_CTX_${Date.now()}`;
      const listName = unique('Sanctions');
      const created = await createList({ name: listName, values: ['CN', 'RU'] }).expect(201);
      const listId = created.body.id as string;

      // Publish a rule that blocks any payload whose country is in the list.
      const rule = await request(app.getHttpServer())
        .post('/api/v1/rules')
        .set(auth(admin.accessToken))
        .send({
          name: `Sanction check ${unique('r')}`,
          context,
          conditionAst: { field: 'country', operator: 'IN_LIST', value: listName },
        })
        .expect(201);
      const published = await request(app.getHttpServer())
        .post(`/api/v1/rules/${rule.body.id}/publish`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(published.body.version).toBe(1);

      const evaluate = (country: string) =>
        request(app.getHttpServer())
          .post('/api/v1/evaluate')
          .set(auth(admin.accessToken))
          .send({ context, data: { country }, mode: 'dry_run' })
          .expect(200);

      // CN is in the list → match.
      expect((await evaluate('CN')).body.matched).toBe(true);
      // US is not → no match.
      expect((await evaluate('US')).body.noMatch).toBe(true);

      // Drop CN from the list — no rule republish, same rule version 1.
      await request(app.getHttpServer())
        .patch(`/api/v1/managed-lists/${listId}`)
        .set(auth(admin.accessToken))
        .send({ values: ['RU'] })
        .expect(200);

      const after = await evaluate('CN');
      expect(after.body.noMatch).toBe(true);

      // RU still in the list → still matches, still version 1 (no republish).
      const stillMatches = await evaluate('RU');
      expect(stillMatches.body.matched).toBe(true);
      expect(stillMatches.body.matchedRuleVersion).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('a second tenant cannot see or mutate the first tenant’s list (404)', async () => {
      const created = await createList({ name: unique('Private'), values: ['secret'] }).expect(201);
      const listId = created.body.id as string;

      const other = await signupTenant(app, 'lists-b');

      const theirList = await request(app.getHttpServer())
        .get('/api/v1/managed-lists')
        .set(auth(other.accessToken))
        .expect(200);
      expect(theirList.body.items.some((l: { id: string }) => l.id === listId)).toBe(false);

      // Cross-tenant fetch by UUID must 404 (never confirm existence).
      await request(app.getHttpServer())
        .patch(`/api/v1/managed-lists/${listId}`)
        .set(auth(other.accessToken))
        .send({ values: ['leak'] })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/managed-lists/${listId}`)
        .set(auth(other.accessToken))
        .expect(404);
    });
  });
});
