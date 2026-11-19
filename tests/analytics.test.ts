import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, saveTransfer, saveSnapshot, listCategories } from '../src/db/repo';
import { saveContract } from '../src/db/contracts';
import {
  reportLines, periodsBetween, cashflow, sumCashflow, pivot, compareByRoot, shiftYear, topPayees,
  contractsPlanVsActual, wealthSeries, accountAudit, listViews, saveView, deleteView, periodLabel,
} from '../src/db/analytics';
import { ACCOUNT_TYPES } from '../src/db/types';
import { balancesAt, netWorth } from '../src/db/reports';

async function setup() {
  const b = await newBook();
  const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
  const giro = saveAccount(b, { name: 'Giro', type: 'checking', owner: 'Anna', opening_balance: 100000 });
  const spar = saveAccount(b, { name: 'Tagesgeld', type: 'savings', owner: 'Ben' });
  const strom = saveContract(b, { name: 'Stromanbieter', amount: -6000, interval: 'monthly', category_id: cat('Strom'), status: 'confirmed' });
  const tx = (date: string, amount: number, category: string, payee: string, extra: Record<string, unknown> = {}) =>
    saveTransaction(b, { account_id: giro, date, amount, payee, category_id: cat(category), autoCategorize: false, ...extra });
  tx('2025-01-05', 300000, 'Gehalt & Lohn', 'Firma');
  tx('2025-01-10', -20000, 'Supermarkt', 'Markt');
  tx('2026-01-05', 320000, 'Gehalt & Lohn', 'Firma');
  tx('2026-01-10', -30000, 'Supermarkt', 'Markt');
  tx('2026-01-15', -6000, 'Strom', 'Stromanbieter', { recurring_id: strom });
  tx('2026-02-15', -6500, 'Strom', 'Stromanbieter', { recurring_id: strom });
  tx('2026-02-20', -50000, 'Sparen & Anlegen', 'Sparplan');
  tx('2026-02-21', -1000, 'Restaurant & Café', 'Café');
  saveTransfer(b, { from_account: giro, to_account: spar, date: '2026-02-01', amount: 10000 });
  return { b, giro, spar, cat };
}

describe('Auswertungen', () => {
  it('Cashflow mit Sparen, Fixkosten und Sparquote', async () => {
    const { b } = await setup();
    const f = { from: '2026-01-01', to: '2026-02-28' };
    const lines = reportLines(b, f);
    expect(lines).toHaveLength(6); // Umbuchung zählt nicht
    const rows = cashflow(lines, periodsBetween(f.from, f.to, 'month'), 'month');
    expect(rows.map((r) => r.period)).toEqual(['2026-01', '2026-02']);
    const s = sumCashflow(rows);
    expect(s.income).toBe(320000);
    expect(s.expense).toBe(30000 + 6000 + 6500 + 1000);
    expect(s.saving).toBe(50000);
    expect(s.fixed).toBe(12500);
    expect(s.net).toBe(320000 - 43500 - 50000);
    expect(s.rate).toBeCloseTo((320000 - 43500) / 320000);
    // Sparen als Ausgabe werten
    const s2 = sumCashflow(cashflow(reportLines(b, { ...f, savingsAsSaving: false }), periodsBetween(f.from, f.to, 'month'), 'month'));
    expect(s2.saving).toBe(0);
    expect(s2.expense).toBe(93500);
  });

  it('filtert nach Person, Kategorie und Suche', async () => {
    const { b, cat } = await setup();
    const f = { from: '2025-01-01', to: '2026-12-31' };
    expect(reportLines(b, { ...f, owners: ['Ben'] })).toHaveLength(0);
    expect(reportLines(b, { ...f, owners: ['Anna'] })).toHaveLength(8);
    expect(reportLines(b, { ...f, categoryId: listCategories(b).find((c) => c.name === 'Wohnen')!.id })).toHaveLength(2);
    expect(reportLines(b, { ...f, categoryId: cat('Supermarkt') })).toHaveLength(2);
    expect(reportLines(b, { ...f, search: 'café' })).toHaveLength(1);
  });

  it('Pivot nach Kategorie und Quartal, aufklappbar', async () => {
    const { b, cat } = await setup();
    const f = { from: '2026-01-01', to: '2026-06-30' };
    const periods = periodsBetween(f.from, f.to, 'quarter');
    expect(periods).toEqual(['2026-Q1', '2026-Q2']);
    expect(periodLabel('2026-Q1')).toBe('1. Qu. 26');
    const lines = reportLines(b, f);
    const wohnen = listCategories(b).find((c) => c.name === 'Wohnen')!.id;
    const closed = pivot(b, lines, periods, 'quarter', 'expense', new Set());
    expect(closed.find((r) => r.name === 'Wohnen')?.cells).toEqual([12500, 0]);
    expect(closed.find((r) => r.name === 'Finanzen')?.total).toBe(50000);
    const open = pivot(b, lines, periods, 'quarter', 'expense', new Set([wohnen]));
    expect(open.find((r) => r.id === cat('Strom'))?.depth).toBe(1);
    expect(closed.reduce((a, r) => a + r.total, 0)).toBe(93500);
  });

  it('Vorjahresvergleich und Empfänger', async () => {
    const { b } = await setup();
    const f = { from: '2026-01-01', to: '2026-01-31' };
    const pf = { from: shiftYear(f.from, -1), to: shiftYear(f.to, -1) };
    expect(shiftYear('2024-02-29', 1)).toBe('2025-02-28');
    const rows = compareByRoot(b, reportLines(b, f), reportLines(b, pf), 'expense');
    const food = rows.find((r) => r.name === 'Lebensmittel')!;
    expect([food.previous, food.current, food.diff]).toEqual([20000, 30000, 10000]);
    expect(food.pct).toBeCloseTo(0.5);
    expect(rows.find((r) => r.name === 'Wohnen')?.pct).toBeNull();
    const p = topPayees(reportLines(b, { from: '2025-01-01', to: '2026-12-31' }));
    expect(p[0]).toMatchObject({ payee: 'Firma', count: 2, income: 620000 });
  });

  it('Verträge: geplant gegen gebucht', async () => {
    const { b } = await setup();
    const rows = contractsPlanVsActual(b, { from: '2026-01-01', to: '2026-03-31' });
    expect(rows[0]).toMatchObject({ name: 'Stromanbieter', planned: 18000, actual: 12500, count: 2 });
  });

  it('Vermögen und Kontoabgleich', async () => {
    const { b, giro, spar } = await setup();
    saveSnapshot(b, spar, '2026-01-31', 500000);
    const w = wealthSeries(b, { from: '2026-01-01', to: '2026-02-28' }, 'month', 'owner', { type: ACCOUNT_TYPES });
    expect(w.keys.sort()).toEqual(['Anna', 'Ben']);
    expect(w.rows[1].Ben).toBe(510000);
    const a = accountAudit(b, { from: '2026-01-01', to: '2026-02-28' });
    const g = a.find((r) => r.id === giro)!;
    expect(g.gap).toBe(0);
    expect(g.transfers).toBe(-10000);
    expect(a.find((r) => r.id === spar)!.gap).toBe(500000); // Stand nur erfasst, keine Buchungen dazu
  });

  it('externe Konten zählen nicht zum Vermögen', async () => {
    const { b, giro } = await setup();
    const ext = saveAccount(b, { name: 'Fremdbank (extern)', type: 'checking', owner: 'Anna', archived: true, external: true });
    saveTransfer(b, { from_account: giro, to_account: ext, date: '2026-02-10', amount: 25000 });
    const w = wealthSeries(b, { from: '2026-01-01', to: '2026-02-28' }, 'month', 'owner', { type: ACCOUNT_TYPES });
    const before = 100000 + 300000 - 20000 + 320000 - 30000 - 6000 - 6500 - 50000 - 1000 - 10000;
    expect(w.rows[1].Anna).toBe(before - 25000); // nur das Giro, das externe Gegenkonto fehlt
    expect(netWorth(b)).toBe(before - 25000 + 10000);
    expect(balancesAt(b, ['2026-02-28'], [ext]).get(ext)).toEqual([25000]); // einzeln abfragbar
    expect(balancesAt(b, ['2026-02-28']).has(ext)).toBe(false);
  });

  it('speichert Ansichten im Haushaltsbuch', async () => {
    const { b } = await setup();
    saveView(b, { name: 'Lebensmittel', query: 'ansicht=kategorien' });
    saveView(b, { name: 'Lebensmittel', query: 'ansicht=vorjahr' });
    expect(listViews(b)).toEqual([{ name: 'Lebensmittel', query: 'ansicht=vorjahr' }]);
    deleteView(b, 'Lebensmittel');
    expect(listViews(b)).toEqual([]);
    expect(() => saveView(b, { name: ' ', query: '' })).toThrow();
  });
});
