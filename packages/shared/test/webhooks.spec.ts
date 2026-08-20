import { describe, expect, it } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MINUTES,
  webhookNextAttemptAt,
} from '../src/webhooks';

const SECRET = 'shh-per-tenant-secret';
const BODY = JSON.stringify({ event: 'request.approved', data: { requestId: 'r1' } });

describe('webhook signing', () => {
  it('produces t=..,v1=.. that verifies against the same body and secret', () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(SECRET, BODY, header)).toBe(true);
  });

  it('is deterministic for a fixed timestamp', () => {
    expect(signWebhookPayload(SECRET, BODY, 1750000000)).toBe(
      signWebhookPayload(SECRET, BODY, 1750000000),
    );
  });

  it('rejects a tampered body', () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY.replace('r1', 'r2'), header)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature('other-secret', BODY, header)).toBe(false);
  });

  it('rejects malformed headers', () => {
    for (const bad of ['', 'v1=abc', 't=123,v1=nothex', 't=123,v1=abc']) {
      expect(verifyWebhookSignature(SECRET, BODY, bad)).toBe(false);
    }
  });

  it('rejects timestamps outside the tolerance window (replay protection)', () => {
    const t = 1750000000;
    const header = signWebhookPayload(SECRET, BODY, t);
    const within = new Date((t + 200) * 1000);
    const outside = new Date((t + 400) * 1000);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: within })).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: outside })).toBe(false);
    expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: outside, toleranceSeconds: 500 }),
    ).toBe(true);
  });
});

describe('retry schedule', () => {
  it('backs off 1m, 5m, 30m, 2h, 12h then dead-letters', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const offsets = WEBHOOK_RETRY_SCHEDULE_MINUTES.map(
      (_, index) => webhookNextAttemptAt(index + 1, from)!.getTime() - from.getTime(),
    );
    expect(offsets).toEqual([1, 5, 30, 120, 720].map((m) => m * 60_000));
    expect(webhookNextAttemptAt(WEBHOOK_MAX_ATTEMPTS, from)).toBeNull();
  });
});
