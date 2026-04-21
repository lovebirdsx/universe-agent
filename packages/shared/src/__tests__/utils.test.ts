import { describe, it, expect } from 'vitest';
import { cn } from '../utils.js';

describe('cn', () => {
  it('joins class names with a space', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar');
  });

  it('returns empty string when all values are falsy', () => {
    expect(cn(false, undefined, null)).toBe('');
  });
});
