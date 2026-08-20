import { describe, expect, it } from 'vitest';
import { isPatternSafe, safeRegexTest } from '../src/rule-evaluator/regex';

describe('isPatternSafe', () => {
  it.each([
    '^[A-Z]{2}\\d{10}$', // typical business pattern (PAN, GST style)
    'hello',
    '^\\d+$',
    '^(a|b)c+$',
    '[a-z]+@[a-z]+\\.[a-z]{2,}',
    '^(abc)?def$', // optional group is fine
  ])('accepts safe pattern %s', (pattern) => {
    expect(isPatternSafe(pattern)).toBe(true);
  });

  it.each([
    '(a+)+$', // classic catastrophic backtracking
    '(a*)*b',
    '((ab)+)+',
    '(\\d+)*x',
    '(a{1,5})+b',
  ])('rejects nested-quantifier pattern %s', (pattern) => {
    expect(isPatternSafe(pattern)).toBe(false);
  });

  it('rejects backreferences', () => {
    expect(isPatternSafe('(a)\\1+')).toBe(false);
  });

  it('rejects overlong patterns', () => {
    expect(isPatternSafe('a'.repeat(201))).toBe(false);
  });
});

describe('safeRegexTest', () => {
  it('matches and non-matches', () => {
    expect(safeRegexTest('^IND', 'INDIA-42')).toEqual({ ok: true, result: true });
    expect(safeRegexTest('^IND', 'USA-42')).toEqual({ ok: true, result: false });
  });

  it('flags invalid patterns', () => {
    expect(safeRegexTest('([unclosed', 'x').note).toBe('invalid_regex');
  });

  it('flags unsafe patterns without executing them', () => {
    expect(safeRegexTest('(a+)+$', 'aaaa')).toEqual({ ok: false, note: 'unsafe_regex' });
  });

  it('refuses oversized inputs', () => {
    expect(safeRegexTest('a', 'a'.repeat(10_001)).note).toBe('input_too_long');
  });

  it('times out catastrophic executions that slip past the screen', () => {
    // Alternation overlap: safe by the nesting heuristic, catastrophic in practice.
    const evil = '^(a|a)+$';
    expect(isPatternSafe(evil)).toBe(true); // heuristic misses it — by design
    const outcome = safeRegexTest(evil, 'a'.repeat(40) + 'b', 25);
    expect(outcome.ok).toBe(false);
    expect(outcome.note).toBe('regex_timeout');
  });
});
