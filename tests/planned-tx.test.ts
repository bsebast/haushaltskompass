import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction } from '../src/db/repo';
import { saveContract } from '../src/db/contracts';
import { plannedTransactions } from '../src/db/plannedTx';

describe('Prognose-Buchungen', () => {
  it('Vertrag und wiederkehrende Buchung, ohne Doppelung und ohne bereits gebuchte Termine', async () => {
    const b = await newBook();
    const a = saveAccount(b, { name: 'Giro', type: 'checking' });
    for (const m of ['07', '08', '09', '10', '11']) {
      saveTransaction(b, { account_id: a, date: `2026-${m}-28`, amount: 250000, payee: 'Arbeitgeber GmbH' });
      saveTransaction(b, { account_id: a, date: `2026-${m}-03`, amount: -4091, payee: 'AXA Krankenversicherung AG' });
      saveTransaction(b, { account_id: a, date: `2026-${m}-10`, amount: -[3412, 5876, 2290, 4410, 3105][Number(m) - 7], payee: 'REWE Markt' });
      saveTransaction(b, { account_id: a, date: `2026-${m}-20`, amount: -[1890, 2650, 1210, 3020, 2275][Number(m) - 7], payee: 'REWE Markt' });
    }
    saveContract(b, { name: 'AXA', amount: -4091, interval: 'monthly', due_day: 1, account_id: a });
    saveContract(b, { name: 'Barmenia', amount: -14330, interval: 'yearly', due_day: 2, due_months: [1], account_id: a });
    saveTransaction(b, { account_id: a, date: '2026-11-25', amount: -999, payee: 'Netflix' }); // nur einmal: kein Muster
    const p = plannedTransactions(b, a, '2027-01-31', '2026-11-26');
    const fmt = p.map((x) => `${x.date} ${x.amount} ${x.source}`);
    expect(fmt).toEqual([
      '2026-12-03 -4091 contract', // Tag aus der letzten echten Zahlung, nicht due_day; das AXA-Muster entfällt
      '2026-12-28 250000 pattern',
      '2027-01-02 -14330 contract',
      '2027-01-03 -4091 contract',
      '2027-01-28 250000 pattern',
    ]);
  });
});
