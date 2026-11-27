import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveContract, listContracts, amountAt, perMonth, announcedPriceChanges, priceHistory } from '../src/db/contracts';
import { applyDuePriceChanges } from '../src/db/core';
import { contractDelta } from '../src/db/forecast';

describe('Angekündigte Beitragsänderung', () => {
  it('gilt erst ab dem Stichtag und wird dann übernommen', async () => {
    const b = await newBook();
    const id = saveContract(b, { name: 'Zahnzusatz', amount: -4091, interval: 'monthly', due_day: 1, next_amount: -4900, next_amount_from: '2027-01-01' });
    const c = listContracts(b).find((x) => x.id === id)!;
    expect(amountAt(c, '2026-12-01')).toBe(-4091);
    expect(amountAt(c, '2027-01-01')).toBe(-4900);
    expect(perMonth(c)).toBe(-4091);
    expect(perMonth(c, '2027-02')).toBe(-4900);
    expect(contractDelta(c, '2026-12', ['2026-10', '2026-11'])).toBe(0);
    expect(contractDelta(c, '2027-01', ['2026-10', '2026-11'])).toBe(-809);
    expect(announcedPriceChanges([c])[0].perYear).toBe(-809 * 12);

    expect(applyDuePriceChanges(b, '2026-12-31')).toBe(0);
    expect(applyDuePriceChanges(b, '2027-01-01')).toBe(1);
    const after = listContracts(b).find((x) => x.id === id)!;
    expect(after.amount).toBe(-4900);
    expect(after.next_amount).toBeNull();
    expect(priceHistory(b, id)).toMatchObject([{ valid_from: '2027-01-01', amount: -4900, previous: -4091 }]);
  });

  it('verlangt Betrag und Datum zusammen', async () => {
    const b = await newBook();
    expect(() => saveContract(b, { name: 'X', amount: -100, interval: 'monthly', next_amount: -200 })).toThrow();
  });
});
