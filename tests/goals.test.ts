import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransfer, saveTransaction, listCategories } from '../src/db/repo';
import { saveGoal, listGoals, depositGoal, deleteGoal, goalProgress, monthsUntil, goalColor } from '../src/db/goals';
import { rangeTotals } from '../src/db/reports';
import { periodCashflow } from '../src/db/analytics';
import { previousRange } from '../src/lib/period';

describe('Sparziele', () => {
  it('von Hand: anlegen, einzahlen, entnehmen, nötige Rate bis zum Datum', async () => {
    const b = await newBook();
    const id = saveGoal(b, { name: ' Urlaub ', target: 300000, target_date: '2027-06-30', saved: 60000, account_id: null, color: null, note: '' });
    const [g] = listGoals(b);
    expect(g.name).toBe('Urlaub');
    expect(g.color).toBe('s1'); // Farbe wird beim Anlegen reihum vergeben
    depositGoal(b, id, 40000);
    depositGoal(b, id, -10000);
    const [p] = goalProgress(b, listGoals(b), '2026-11-25');
    expect(p.current).toBe(90000);
    expect(p.remaining).toBe(210000);
    expect(p.monthsLeft).toBe(8); // Nov 26 bis Jun 27
    expect(p.perMonth).toBe(26250);
    expect(p.overdue).toBe(false);
    expect(p.pace).toBeNull();
    depositGoal(b, id, -999999);
    expect(listGoals(b)[0].saved).toBe(0); // nie unter 0
    deleteGoal(b, id);
    expect(listGoals(b)).toHaveLength(0);
  });

  it('prüft Eingaben', async () => {
    const b = await newBook();
    expect(() => saveGoal(b, { name: '', target: 100, target_date: null, saved: 0, account_id: null, color: null, note: null })).toThrow(/Namen/);
    expect(() => saveGoal(b, { name: 'X', target: 0, target_date: null, saved: 0, account_id: null, color: null, note: null })).toThrow(/Zielbetrag/);
  });

  it('mit Konto: Stand und Tempo aus dem Kontostand, Konto löschen hebt Verknüpfung auf', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 1000000 });
    const tg = saveAccount(b, { name: 'Tagesgeld', type: 'savings', opening_balance: 0 });
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) saveTransfer(b, { from_account: giro, to_account: tg, date: `${m}-01`, amount: 50000 });
    const id = saveGoal(b, { name: 'Notgroschen', target: 1000000, target_date: null, saved: 12345, account_id: tg, color: 's3', note: null });
    expect(listGoals(b)[0].saved).toBe(0); // mit Konto kein Handstand
    const [p] = goalProgress(b, listGoals(b), '2026-11-25');
    expect(p.current).toBe(300000);
    expect(p.pace).toBe(50000);
    expect(p.eta).toBe('2028-01'); // 700.000 / 50.000 = 14 Monate
    expect(p.perMonth).toBeNull();
    expect(() => depositGoal(b, id, 100)).toThrow(/Konto/);
    b.run('delete from transactions where account_id = ? or account_id = ?', [tg, giro]);
    b.run('delete from accounts where id = ?', [tg]);
    expect(listGoals(b)[0].account_id).toBeNull();
  });

  it('Zieldatum vorbei und erreicht', async () => {
    const b = await newBook();
    saveGoal(b, { name: 'Alt', target: 1000, target_date: '2026-01-31', saved: 500, account_id: null, color: null, note: null });
    saveGoal(b, { name: 'Voll', target: 1000, target_date: '2027-01-31', saved: 1500, account_id: null, color: null, note: null });
    const [a, v] = goalProgress(b, listGoals(b), '2026-11-25');
    expect(a.overdue).toBe(true);
    expect(a.perMonth).toBeNull();
    expect(v.reached).toBe(true);
    expect(v.ratio).toBe(1);
    expect(monthsUntil('2026-11-30', '2026-11-25')).toBe(1);
    expect(goalColor({ color: null }, 9)).toBe('rgb(var(--c-s2))');
  });
});

describe('Übersicht: Vergleich und Sparquote', () => {
  it('Vormonat bis zum gleichen Tag, abgeschlossener Monat ganz, YTD gegen Vorjahr', () => {
    expect(previousRange({ kind: 'month', month: '2026-11' }, '2026-11-25')).toEqual({ from: '2026-10-01', to: '2026-10-25', label: 'Oktober bis zum 25.' });
    expect(previousRange({ kind: 'month', month: '2026-03' }, '2026-03-31')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange({ kind: 'month', month: '2026-09' }, '2026-11-25')).toEqual({ from: '2026-08-01', to: '2026-08-31', label: 'Vormonat' });
    expect(previousRange({ kind: 'ytd', year: 2026 }, '2026-11-25')).toEqual({ from: '2025-01-01', to: '2025-11-25', label: '2025 bis 25.11.' });
    expect(previousRange({ kind: 'ytd', year: 2025 }, '2026-11-25')).toEqual({ from: '2024-01-01', to: '2024-12-31', label: 'Jahr 2024' });
  });

  it('Summen und Sparquote wie in den Auswertungen', async () => {
    const b = await newBook();
    const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
    const giro = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveTransaction(b, { account_id: giro, date: '2026-10-01', amount: 300000, payee: 'Firma', category_id: cat('Gehalt & Lohn'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-10-05', amount: -120000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-10-28', amount: -30000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    expect(rangeTotals(b, '2026-10-01', '2026-10-25')).toEqual({ income: 300000, expense: 120000 });
    const f = periodCashflow(b, '2026-10-01', '2026-10-31');
    expect(f.rate).toBeCloseTo(0.5);
    expect(periodCashflow(b, '2026-09-01', '2026-09-30').rate).toBeNull();
  });
});
