import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant } from './utils';

/**
 * The money test of Phase 1: tenant A must not be able to read or write
 * tenant B's data — through the API, and directly at the Postgres layer
 * where RLS is the last line of defense.
 */
describe('Tenant isolation / RLS (e2e)', () => {
  let app: INestApplication;
  let tenantA: SignedUpTenant;
  let tenantB: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await signupTenant(app, 'iso-a');
    tenantB = await signupTenant(app, 'iso-b');
  });

  afterAll(async () => {
    await app.close();
  });

  it('user lists never cross tenants', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set(auth(tenantA.accessToken))
      .expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain(tenantA.email);
    expect(emails).not.toContain(tenantB.email);
  });

  it("fetching another tenant's user by UUID returns 404, not 403", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/users/${tenantB.userId}`)
      .set(auth(tenantA.accessToken))
      .expect(404);
  });

  it("mutating another tenant's user by UUID returns 404", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${tenantB.userId}`)
      .set(auth(tenantA.accessToken))
      .send({ status: 'deactivated' })
      .expect(404);

    // B is untouched
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(me.body.status).toBe('active');
  });

  it('RLS fails closed: no tenant context = zero rows, even without a WHERE clause', async () => {
    const tenantPrisma = app.get(TenantPrismaService);
    // Raw client on the app role with NO tenant context set — simulates a
    // forgotten tenant filter. Must see nothing.
    const rows = await tenantPrisma.raw.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM users`;
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('RLS scopes reads: tenant A context cannot see tenant B rows', async () => {
    const tenantPrisma = app.get(TenantPrismaService);
    const clientA = tenantPrisma.forTenant(tenantA.tenantId);

    const own = await clientA.user.findUnique({ where: { id: tenantA.userId } });
    expect(own?.email).toBe(tenantA.email);

    const foreign = await clientA.user.findUnique({ where: { id: tenantB.userId } });
    expect(foreign).toBeNull();
  });

  it('RLS scopes writes: tenant A context cannot update tenant B rows', async () => {
    const tenantPrisma = app.get(TenantPrismaService);
    const result = await tenantPrisma
      .forTenant(tenantA.tenantId)
      .user.updateMany({ where: { id: tenantB.userId }, data: { name: 'hacked' } });
    expect(result.count).toBe(0);
  });

  it('RLS blocks cross-tenant inserts (WITH CHECK)', async () => {
    const tenantPrisma = app.get(TenantPrismaService);
    await expect(
      tenantPrisma.forTenant(tenantA.tenantId).role.create({
        data: { tenantId: tenantB.tenantId, name: 'smuggled-role' },
      }),
    ).rejects.toThrow();
  });

  it('audit log queries are tenant-scoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit')
      .set(auth(tenantA.accessToken))
      .expect(200);
    const foreignRows = res.body.items.filter(
      (event: { tenantId: string }) => event.tenantId !== tenantA.tenantId,
    );
    expect(foreignRows).toHaveLength(0);
  });
});
