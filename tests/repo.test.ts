import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import {
  saveAccount, listAccounts, saveTransaction, saveTransfer, listTransactions, deleteTransaction,
  listCategories, saveRule, saveBudget, applyRulesToUncategorized, deleteCategory,
} from '../src/db/repo';
import { monthlyTotals, categoryTotals, budgetStatus, balanceTrend } from '../src/db/reports';

const cat = (b: Awaited<ReturnType<typeof newBook>>, name: string) => listCategories(b).find((c) => c.name === name)!.id;

describe('Datenlayer', () => {
  it('legt Standardkategorien an', async () => {
    const b = await newBook();
    expect(listCategories(b).length).toBeGreaterThan(40);
  });

  it('berechnet Salden aus Anfangssaldo und Buchungen', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 100000 });
    saveTransaction(b, { account_id: g, date: '2026-11-02', amount: -4599, payee: 'REWE' });
    saveTransaction(b, { account_id: g, date: '2026-11-01', amount: 250000, payee: 'Arbeitgeber' });
    expect(listAccounts(b)[0].balance).toBe(100000 - 4599 + 250000);
  });

  it('Umbuchungen zählen nicht als Einnahme oder Ausgabe', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    const s = saveAccount(b, { name: 'Bar', type: 'cash' });
    saveTransfer(b, { from_account: g, to_account: s, date: '2026-11-03', amount: 10000 });
    const [m] = monthlyTotals(b, '2026-11', '2026-11');
    expect(m.income).toBe(0);
    expect(m.expense).toBe(0);
    expect(listAccounts(b).map((a) => a.balance).sort()).toEqual([-10000, 10000]);
    const tx = listTransactions(b);
    expect(tx).toHaveLength(2);
    deleteTransaction(b, tx[0].id);
    expect(listTransactions(b)).toHaveLength(0);
  });

  it('Aufteilung muss aufgehen und wird in Auswertungen aufgelöst', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    const food = cat(b, 'Supermarkt');
    const drug = cat(b, 'Drogerie');
    expect(() => saveTransaction(b, { account_id: g, date: '2026-11-05', amount: -5000, splits: [{ category_id: food, amount: -3000 }] })).toThrow();
    saveTransaction(b, { account_id: g, date: '2026-11-05', amount: -5000, splits: [{ category_id: food, amount: -3000 }, { category_id: drug, amount: -2000 }] });
    const totals = categoryTotals(b, '2026-11-01', '2026-11-30', 'expense');
    expect(totals.find((t) => t.name === 'Lebensmittel')?.amount).toBe(3000);
    expect(totals.find((t) => t.name === 'Einkäufe')?.amount).toBe(2000);
  });

  it('Regeln kategorisieren automatisch', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveTransaction(b, { account_id: g, date: '2026-11-05', amount: -1299, payee: 'Netflix International' });
    saveRule(b, { field: 'payee', op: 'contains', value: 'netflix', category_id: cat(b, 'Streaming') });
    saveTransaction(b, { account_id: g, date: '2026-12-05', amount: -1299, payee: 'NETFLIX.COM' });
    expect(listTransactions(b, { from: '2026-12-01' })[0].category_name).toBe('Streaming');
    expect(applyRulesToUncategorized(b)).toBe(1);
    expect(listTransactions(b, { uncategorized: true })).toHaveLength(0);
  });

  it('Suche findet Text und Beträge', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveTransaction(b, { account_id: g, date: '2026-11-05', amount: -4599, payee: 'Edeka Müller', purpose: 'Einkauf' });
    saveTransaction(b, { account_id: g, date: '2026-11-06', amount: -1000, payee: 'Bäckerei' });
    expect(listTransactions(b, { search: 'müller' })).toHaveLength(1);
    expect(listTransactions(b, { search: '45,99' })).toHaveLength(1);
    expect(listTransactions(b, { search: 'xyz' })).toHaveLength(0);
  });

  it('Budgetstatus summiert Unterkategorien', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveBudget(b, { category_id: cat(b, 'Lebensmittel'), period: 'month', amount: 40000, valid_from: '2026-01' });
    saveTransaction(b, { account_id: g, date: '2026-03-05', amount: -30000, category_id: cat(b, 'Supermarkt') });
    saveTransaction(b, { account_id: g, date: '2026-03-07', amount: -15000, category_id: cat(b, 'Getränke') });
    const [s] = budgetStatus(b, '2026-03');
    expect(s.spent).toBe(45000);
    expect(s.state).toBe('over');
  });

  it('Saldenverlauf am Monatsende', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 1000 });
    saveTransaction(b, { account_id: g, date: '2026-01-15', amount: 500 });
    saveTransaction(b, { account_id: g, date: '2026-03-15', amount: -200 });
    expect(balanceTrend(b, '2026-02', '2026-03').map((x) => x.balance)).toEqual([1500, 1300]);
  });

  it('Kategorie löschen hängt Buchungen um', async () => {
    const b = await newBook();
    const g = saveAccount(b, { name: 'Giro', type: 'checking' });
    const s = cat(b, 'Streaming');
    saveTransaction(b, { account_id: g, date: '2026-11-05', amount: -999, category_id: s });
    deleteCategory(b, s, cat(b, 'Software'));
    expect(listTransactions(b)[0].category_name).toBe('Software');
  });
});
