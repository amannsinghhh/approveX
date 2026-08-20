import { describe, expect, it } from 'vitest';
import { DEFINITION_STATUSES, REQUEST_STATUSES } from '../src/index';

describe('@approvex/shared', () => {
  it('exposes the request lifecycle statuses', () => {
    expect(REQUEST_STATUSES).toEqual(['pending', 'approved', 'rejected', 'cancelled', 'expired']);
  });

  it('exposes the definition statuses', () => {
    expect(DEFINITION_STATUSES).toEqual(['draft', 'published', 'archived']);
  });
});
