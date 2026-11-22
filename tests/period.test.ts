import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, saveBudget, listCategories } from '../src/db/repo';
import { budgetStatusRange } from '../src/db/reports';
import { formatPeriod, parsePeriod, periodRange, shiftPeriod, switchKind } from '../src/lib/period';

const NOW = '2026-11-22';

describe('Zeitraum der Übersicht', () => {
  it('liest und schreibt den URL-Wert', () => {
    expect(parsePeriod(null, NOW)).toEqual({ kind: 'month', month: '2026-11' });
    expect(parsePeriod('2026-03', NOW)).toEqual({ kind: 'month', month: '2026-03' });
    expect(parsePeriod('2026-13', NOW)).toEqual({ kind: 'month', month: '2026-11' });
    expect(parsePeriod('ytd', NOW)).toEqual({ kind: 'ytd', year: 2026 });
    expect(parsePeriod('ytd-2025', NOW)).toEqual({ kind: 'ytd', year: 2025 });
    expect(formatPeriod({ kind: 'month', month: '2026-11' }, NOW)).toBe('');
    expect(formatPeriod({ kind: 'month', month: '2026-03' }, NOW)).toBe('2026-03');
    expect(formatPeriod({ kind: 'ytd', year: 2026 }, NOW)).toBe('ytd');
    expect(formatPeriod({ kind: 'ytd', year: 2025 }, NOW)).toBe('ytd-2025');
  });

  it('berechnet Monat und YTD', () => {
    expect(periodRange({ kind: 'month', month: '2026-02' }, NOW)).toMatchObject({ from: '2026-02-01', to: '2026-02-28', current: false, label: 'Februar 2026' });
    expect(periodRange({ kind: 'month', month: '2026-11' }, NOW)).toMatchObject({ to: '2026-11-30', current: true });
    expect(periodRange({ kind: 'ytd', year: 2026 }, NOW)).toMatchObject({ from: '2026-01-01', to: NOW, fromMonth: '2026-01', toMonth: '2026-11', current: true, label: '2026 bis heute' });
    expect(periodRange({ kind: 'ytd', year: 2025 }, NOW)).toMatchObject({ to: '2025-12-31', toMonth: '2025-12', current: false, label: 'Jahr 2025' });
  });

  it('blättert und wechselt die Art', () => {
    expect(shiftPeriod({ kind: 'month', month: '2026-01' }, -1)).toEqual({ kind: 'month', month: '2025-12' });
    expect(shiftPeriod({ kind: 'ytd', year: 2026 }, -1)).toEqual({ kind: 'ytd', year: 2025 });
    expect(switchKind({ kind: 'month', month: '2025-04' }, 'ytd', NOW)).toEqual({ kind: 'ytd', year: 2025 });
    expect(switchKind({ kind: 'ytd', year: 2026 }, 'month', NOW)).toEqual({ kind: 'month', month: '2026-11' });
    expect(switchKind({ kind: 'ytd', year: 2025 }, 'month', NOW)).toEqual({ kind: 'month', month: '2025-12' });
  });
});

describe('Budgets über mehrere Monate', () => {
  it('rechnet Monatsbudgets je gültigem Monat hoch, Jahresbudgets einmal', async () => {
    const b = await newBook();
    const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
    const giro = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveTransaction(b, { account_id: giro, date: '2025-02-10', amount: -30000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2025-03-10', amount: -20000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2025-03-12', amount: -5000, payee: 'Stadtwerke', category_id: cat('Strom'), autoCategorize: false });
    saveBudget(b, { category_id: cat('Supermarkt'), period: 'month', amount: 25000, valid_from: '2025-02' });
    saveBudget(b, { category_id: cat('Strom'), period: 'year', amount: 60000, valid_from: '2025-01' });
    const rows = budgetStatusRange(b, '2025-01-01', '2025-12-31');
    const markt = rows.find((r) => r.category.name === 'Supermarkt')!;
    expect(markt.limit).toBe(25000 * 11); // Februar bis Dezember
    expect(markt.spent).toBe(50000);
    const strom = rows.find((r) => r.category.name === 'Strom')!;
    expect(strom.limit).toBe(60000);
    expect(strom.spent).toBe(5000);
  });
});
