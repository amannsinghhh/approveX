/**
 * Worker tests run against their own database (approvex_worker_test) so they
 * never collide with the API suite, which owns approvex_test. Owner
 * credentials: the worker always runs on the owner connection.
 */
export function testDbUrl(): string {
  const base =
    process.env.DATABASE_URL ??
    'postgresql://approvex:approvex@localhost:5432/approvex?schema=public';
  const url = new URL(base);
  url.pathname = '/approvex_worker_test';
  return url.toString();
}
