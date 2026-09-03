/**
 * Test-database URLs, shared by vitest.config.ts (worker env) and
 * global-setup.ts (creates + migrates the DB). Tests always run against
 * `approvex_test`, never the dev database.
 */
export function testDbUrls(): { owner: string; app: string } {
  const base =
    process.env.DATABASE_URL ??
    'postgresql://approvex:approvex@localhost:5432/approvex?schema=public';

  const owner = new URL(base);
  owner.pathname = '/approvex_test';

  const app = new URL(owner.toString());
  app.username = 'approvex_app';
  app.password = 'approvex_app';

  return { owner: owner.toString(), app: app.toString() };
}
