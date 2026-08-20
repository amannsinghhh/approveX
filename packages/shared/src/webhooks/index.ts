/**
 * Webhook signing + retry schedule, shared by the API (enqueue/verify docs),
 * the worker (delivery), and customer-facing verification examples.
 *
 * Signature format (Stripe-style): `t=<unix seconds>,v1=<hex hmac>` where the
 * HMAC-SHA256 input is `${t}.${rawBody}` keyed with the tenant webhook secret.
 * Binding the timestamp into the MAC blocks replay outside the tolerance.
 */

interface NodeCrypto {
  createHmac(
    algorithm: string,
    key: string,
  ): {
    update(data: string): { digest(encoding: 'hex'): string };
  };
}

// node:crypto via getBuiltinModule: works in ESM and CJS, and — critically —
// is invisible to browser bundlers, keeping this package importable from the
// web app (which never signs anything).
function getCrypto(): NodeCrypto {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const crypto = proc?.getBuiltinModule?.('node:crypto') as NodeCrypto | undefined;
  if (!crypto) throw new Error('Webhook signing requires a Node.js runtime');
  return crypto;
}

/** Minutes to wait before attempt n+1 after n failures; exhausted ⇒ dead-letter. */
export const WEBHOOK_RETRY_SCHEDULE_MINUTES = [1, 5, 30, 120, 720] as const;

/** Delivery attempts before a row dead-letters (initial try + retries). */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MINUTES.length + 1;

/**
 * When to retry after `failedAttempts` failures (1 = first attempt failed).
 * Returns null when the schedule is exhausted — dead-letter the row.
 */
export function webhookNextAttemptAt(failedAttempts: number, from: Date = new Date()): Date | null {
  const minutes = WEBHOOK_RETRY_SCHEDULE_MINUTES[failedAttempts - 1];
  if (minutes === undefined) return null;
  return new Date(from.getTime() + minutes * 60_000);
}

export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const mac = getCrypto()
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Verifies an X-ApproveX-Signature header against the raw request body.
 * Rejects malformed headers, wrong MACs (timing-safe), and timestamps outside
 * `toleranceSeconds` (default 5 minutes) of `now`.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
  options: { toleranceSeconds?: number; now?: Date } = {},
): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader);
  const presented = match?.[2];
  if (!match || !presented) return false;
  const timestamp = Number(match[1]);

  const tolerance = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const crypto = getCrypto();
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  // Timing-safe without Buffer typings: comparing re-MACed values leaks no
  // byte-position information about `expected`.
  const mask = (value: string): string =>
    crypto.createHmac('sha256', 'approvex-compare').update(value).digest('hex');
  return mask(expected) === mask(presented);
}

/** Outbox event types a tenant can subscribe an endpoint to. */
export const WEBHOOK_EVENT_TYPES = [
  'request.created',
  'request.approved',
  'request.rejected',
  'request.cancelled',
  'step.escalated',
  'workflow.webhook_call',
  'ping',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
