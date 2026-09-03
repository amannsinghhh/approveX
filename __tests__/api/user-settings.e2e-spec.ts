import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignedUpTenant } from './utils';
import { auth, createTestApp, signupTenant } from './utils';

describe('Per-user settings (e2e)', () => {
  let app: INestApplication;
  let admin: SignedUpTenant;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signupTenant(app, 'settings');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty and is included in /me', async () => {
    const settings = await request(app.getHttpServer())
      .get('/api/v1/me/settings')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(settings.body).toEqual({});

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(me.body.settings).toEqual({});
  });

  it('shallow-merges patches so one key does not clobber another', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set(auth(admin.accessToken))
      .send({ dismissedConceptStrips: { rulebuilder: true } })
      .expect(200);

    const second = await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set(auth(admin.accessToken))
      .send({ plainLanguage: true })
      .expect(200);

    expect(second.body).toEqual({
      dismissedConceptStrips: { rulebuilder: true },
      plainLanguage: true,
    });

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(me.body.settings.plainLanguage).toBe(true);
  });

  it('is self-scoped: a second user has independent settings', async () => {
    const other = await signupTenant(app, 'settings-b');
    const theirs = await request(app.getHttpServer())
      .get('/api/v1/me/settings')
      .set(auth(other.accessToken))
      .expect(200);
    expect(theirs.body).toEqual({});
  });
});
