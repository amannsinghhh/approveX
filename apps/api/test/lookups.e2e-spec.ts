import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant, unique } from './utils';

/**
 * M5-CP3 (B.3 #10): `source: looked_up` fields resolve via an outbound HTTP
 * call at evaluation time, degrading per the field's fallback behavior.
 * Test scenario 20: external lookup timeout → fallback applied, never a
 * silent pass.
 */
describe('External lookups (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;
  let lookupServer: Server;
  let base: string;

  /** When true, /flaky answers 500 instead of a value (cache-fallback tests). */
  let flakyFails = false;

  const server = () => app.getHttpServer();

  /** Field names must match FIELD_PATTERN (dot path) — no dashes. */
  const uniqueField = (prefix: string) => unique(prefix).replace(/-/g, '_');

  const createField = (name: string, meta: Record<string, unknown>) =>
    request(server())
      .post('/api/v1/fields')
      .set(auth(admin.accessToken))
      .send({ name, type: 'string', ...meta });

  const createLookupField = async (name: string, path: string, fallback?: string) => {
    await createField(name, {
      source: 'looked_up',
      lookupUrl: `${base}${path}`,
      ...(fallback ? { lookupFallback: fallback } : {}),
    }).expect(201);
  };

  const publishRule = async (context: string, conditionAst: Record<string, unknown>) => {
    const created = await request(server())
      .post('/api/v1/rules')
      .set(auth(admin.accessToken))
      .send({ name: `lookup ${unique('r')}`, context, conditionAst })
      .expect(201);
    await request(server())
      .post(`/api/v1/rules/${created.body.id}/publish`)
      .set(auth(admin.accessToken))
      .expect(200);
  };

  const dryRun = (context: string, data: Record<string, unknown>) =>
    request(server())
      .post('/api/v1/evaluate')
      .set(auth(admin.accessToken))
      .send({ context, data, mode: 'dry_run' });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'lkp');

    lookupServer = createServer((req, res) => {
      if (req.url === '/blocked') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ value: 'blocked' }));
        return;
      }
      if (req.url === '/flaky') {
        if (flakyFails) {
          res.writeHead(500).end();
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ value: 'trusted' }));
        }
        return;
      }
      if (req.url === '/hang') return; // never answers — exercises the 2s timeout
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => lookupServer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(lookupServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    lookupServer.closeAllConnections();
    await new Promise<void>((resolve) => lookupServer.close(() => resolve()));
    await app.close();
  });

  it('rejects misconfigured lookup fields at the registry', async () => {
    // looked_up without a URL — nowhere to resolve from.
    const missingUrl = await createField(uniqueField('lkp_no_url'), { source: 'looked_up' });
    expect(missingUrl.status).toBe(400);

    // lookupUrl on a payload field is meaningless.
    const strayUrl = await createField(uniqueField('lkp_stray'), {
      source: 'payload',
      lookupUrl: `${base}/blocked`,
    });
    expect(strayUrl.status).toBe(400);
  });

  it('resolves a looked_up field from the endpoint (payload value is ignored)', async () => {
    const field = uniqueField('vendor_status');
    const context = `CTX_LKP_OK_${Date.now()}`;
    await createLookupField(field, '/blocked');
    await publishRule(context, { field, operator: '=', value: 'blocked' });

    // The payload claims "clean" — the lookup's "blocked" must win.
    const res = await dryRun(context, { [field]: 'clean' }).expect(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.evaluationTrace.nodes[0]?.actual).toBe('blocked');
  });

  it('lookup timeout → treat_as_no_match fallback, never a silent pass (scenario 20)', async () => {
    const field = uniqueField('slow_status');
    const context = `CTX_LKP_TIMEOUT_${Date.now()}`;
    await createLookupField(field, '/hang'); // default fallback: treat_as_no_match

    // != would "pass" if the missing value leaked through as a mere non-match
    // of the payload — the evaluator must fail the comparison closed instead.
    await publishRule(context, { field, operator: '!=', value: 'blocked' });

    const res = await dryRun(context, { [field]: 'anything' }).expect(200);
    expect(res.body.matched).toBe(false);
    expect(res.body.noMatch).toBe(true);
  }, 15_000);

  it('use_cached_value serves the last good value when the endpoint fails', async () => {
    const field = uniqueField('cached_status');
    const context = `CTX_LKP_CACHE_${Date.now()}`;
    await createLookupField(field, '/flaky', 'use_cached_value');
    await publishRule(context, { field, operator: '=', value: 'trusted' });

    // Healthy endpoint → match, and the value is cached per payload identity.
    flakyFails = false;
    const warm = await dryRun(context, { vendor: 'V1' }).expect(200);
    expect(warm.body.matched).toBe(true);

    // Endpoint down → same payload still matches via the cached value…
    flakyFails = true;
    const cached = await dryRun(context, { vendor: 'V1' }).expect(200);
    expect(cached.body.matched).toBe(true);

    // …but an unseen payload has no cache entry and fails closed.
    const cold = await dryRun(context, { vendor: 'V-cold' }).expect(200);
    expect(cold.body.matched).toBe(false);
    flakyFails = false;
  });

  it('block_and_alert refuses the evaluation (503) when the lookup fails', async () => {
    const field = uniqueField('kyc_status');
    const context = `CTX_LKP_BLOCK_${Date.now()}`;
    await createLookupField(field, '/fail-always', 'block_and_alert');
    await publishRule(context, { field, operator: '=', value: 'verified' });

    await dryRun(context, { any: 'payload' }).expect(503);
  });
});
