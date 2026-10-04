import { describe, expect, it } from 'vitest';
import { applyKey, formatDisplay, fromUnits, normalize, splitDisplay, toUnits } from './money';

describe('money', () => {
  it('converts between strings and units exactly', () => {
    expect(toUnits('0.1', 6) + toUnits('0.2', 6)).toBe(toUnits('0.3', 6));
    expect(fromUnits(toUnits('1248.5', 6), 6)).toBe('1248.5');
    expect(fromUnits(-150000n, 6)).toBe('-0.15');
    expect(toUnits('abc', 6)).toBe(0n);
  });

  it('formats with grouping and fixed fraction', () => {
    expect(splitDisplay('1248.5', 2)).toEqual({ int: '1 248', frac: '50' });
    expect(formatDisplay('1000000', 2)).toBe('1 000 000.00');
    expect(formatDisplay('-3.2', 3)).toBe('−3.200');
  });

  it('applies keypad input safely', () => {
    const type = (keys: string[], frac = 2) => keys.reduce((acc, k) => applyKey(acc, k, frac), '');
    expect(type(['1', '2', '.', '5', '0', '9'])).toBe('12.50');
    expect(type(['.', '5'])).toBe('0.5');
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['1', '.', '.', '2'])).toBe('1.2');
    expect(type(['5', 'back', 'back'])).toBe('');
    expect(type(['1', '.'], 0)).toBe('1');
    expect(type(Array(12).fill('9'))).toBe('999999999');
    expect(normalize('12.')).toBe('12');
    expect(normalize('')).toBe('0');
  });
});
