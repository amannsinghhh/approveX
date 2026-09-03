import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../apps/api/src/audit/audit.service';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant } from './utils';

describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let tenant: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await signupTenant(app, 'audit');
  });

  afterAll(async () => {
    await app.close();
  });

  it('signup produced a tenant.created event', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit?entity=tenant')
      .set(auth(tenant.accessToken))
      .expect(200);
    const event = res.body.items.find(
      (e: { eventType: string }) => e.eventType === 'tenant.created',
    );
    expect(event).toBeTruthy();
    expect(event.actorUserId).toBe(tenant.userId);
  });

  it('the audit interceptor logs mutating endpoints automatically', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set(auth(tenant.accessToken))
      .send({ name: 'Audited role', permissionKeys: [] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/audit?entity=roles')
      .set(auth(tenant.accessToken))
      .expect(200);
    const event = res.body.items.find(
      (e: { eventType: string }) => e.eventType === 'roles.created',
    );
    expect(event).toBeTruthy();
    expect(event.after.name).toBe('Audited role');
  });

  it('sensitive fields are redacted before they reach the log', async () => {
    const audit = app.get(AuditService);
    await audit.record({
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      eventType: 'test.redaction',
      entityType: 'test',
      after: { password: 'hunter2', nested: { apiToken: 'abc', safe: 'keep' } },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/audit?entity=test')
      .set(auth(tenant.accessToken))
      .expect(200);
    const event = res.body.items.find(
      (e: { eventType: string }) => e.eventType === 'test.redaction',
    );
    expect(event.after.password).toBe('[REDACTED]');
    expect(event.after.nested.apiToken).toBe('[REDACTED]');
    expect(event.after.nested.safe).toBe('keep');
  });

  it('audit rows cannot be updated or deleted — even by the table owner', async () => {
    const prisma = app.get(PrismaService);
    const row = await prisma.auditEvent.findFirst({ where: { tenantId: tenant.tenantId } });
    expect(row).toBeTruthy();

    await expect(
      prisma.$executeRaw`UPDATE audit_events SET event_type = 'tampered' WHERE id = ${row!.id}::uuid`,
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$executeRaw`DELETE FROM audit_events WHERE id = ${row!.id}::uuid`,
    ).rejects.toThrow(/append-only/);

    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
  });

  it('audit access requires the audit:view permission', async () => {
    // A fresh role-less user has no audit:view
    const viewer = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set(auth(tenant.accessToken))
      .send({
        email: `${tenant.slug}-noperm@example.com`,
        roleIds: [
          (
            await request(app.getHttpServer())
              .post('/api/v1/roles')
              .set(auth(tenant.accessToken))
              .send({ name: 'No permissions', permissionKeys: [] })
          ).body.id,
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invitation')
      .send({ token: viewer.body.token, name: 'NP', password: 'password-123' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `${tenant.slug}-noperm@example.com`, password: 'password-123' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/audit')
      .set(auth(login.body.accessToken))
      .expect(403);
  });
});
