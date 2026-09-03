import { describe, expect, it } from 'vitest';
import { resolvePath } from '../../shared/src/rule-evaluator/path';

describe('resolvePath', () => {
  const data = {
    amount: 200000,
    vendor: { country: 'India', rating: null },
    items: [{ category: 'electronics', tags: ['a', 'b'] }, { category: 'furniture' }],
    matrix: [
      [1, 2],
      [3, 4],
    ],
    'weird key': 1,
    zero: 0,
    empty: '',
    falsy: false,
  };

  it.each([
    ['amount', true, 200000],
    ['vendor.country', true, 'India'],
    ['items[0].category', true, 'electronics'],
    ['items[1].category', true, 'furniture'],
    ['items[0].tags[1]', true, 'b'],
    ['matrix[1][0]', true, 3],
    ['zero', true, 0],
    ['empty', true, ''],
    ['falsy', true, false],
  ])('resolves %s', (path, found, value) => {
    expect(resolvePath(data, path)).toEqual({ found, value });
  });

  it('reports explicit null as found', () => {
    expect(resolvePath(data, 'vendor.rating')).toEqual({ found: true, value: null });
  });

  it.each([
    'missing',
    'vendor.missing',
    'vendor.country.deeper',
    'items[9].category',
    'items[-1]',
    'items[x]',
    'amount.nested',
    '',
  ])('reports %s as not found', (path) => {
    expect(resolvePath(data, path).found).toBe(false);
  });

  it('does not fall back to prototype properties', () => {
    expect(resolvePath(data, 'toString').found).toBe(false);
    expect(resolvePath(data, 'vendor.constructor').found).toBe(false);
  });

  it('handles non-object roots', () => {
    expect(resolvePath(null, 'a').found).toBe(false);
    expect(resolvePath(undefined, 'a').found).toBe(false);
    expect(resolvePath(42, 'a').found).toBe(false);
    expect(resolvePath('str', 'length').found).toBe(false);
  });
});
