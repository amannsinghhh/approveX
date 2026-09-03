/**
 * No-login approval token crypto — the one place mint and verify agree.
 *
 * The raw token lives only inside the emailed/messaged URL. We persist just its
 * sha256, so a stolen database, log line, or error message can never reveal a
 * working link. Because minting happens in two deployables (the API's
 * ApprovalTokensService and the worker's notification processor) while
 * verification happens only in the API, the hashing contract MUST be identical
 * across all of them — so it lives here, imported by every caller.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Bytes of entropy in a raw token before hex-encoding. */
export const APPROVAL_TOKEN_BYTES = 32;

/** The only representation of a token we ever store or compare against. */
export function hashApprovalToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Mint a fresh token. Returns the raw token (hand to the delivery layer once,
 * then forget) alongside the hash (persist this).
 */
export function generateApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(APPROVAL_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashApprovalToken(token) };
}
