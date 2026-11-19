import { describe, it, expect } from 'vitest';
import { parseAmount, formatCents } from '../src/lib/money';
import { parseDate, addMonths, monthRange } from '../src/lib/dates';

describe('parseAmount', () => {
  it.each([
    ['12', 1200], ['12,5', 1250], ['12.50', 1250], ['1.234,56', 123456], ['1,234.56', 123456],
    ['1.234', 123400], ['-3', -300], ['−4,20 €', -420], ['0,01', 1], ['15,00-', -1500], ['2,345', 235],
  ])('%s → %i', (s, v) => expect(parseAmount(s)).toBe(v));
  it.each(['', 'abc', '1,2,3,4.5.6', '12a'])('ungültig: %s', (s) => expect(parseAmount(s)).toBeNull());
  it('formatiert deutsch', () => expect(formatCents(123456).replace(/ /g, ' ')).toBe('1.234,56 €'));
});

describe('dates', () => {
  it('liest deutsche Daten', () => {
    expect(parseDate('31.12.2026')).toBe('2026-12-31');
    expect(parseDate('1.2.26')).toBe('2026-02-01');
    expect(parseDate('30.02.2026')).toBeNull();
  });
  it('rechnet Monate', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
