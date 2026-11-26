import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, deleteTransaction, listCategories, listTransactions } from '../src/db/repo';
import { saveContract } from '../src/db/contracts';
import { monthBalance } from '../src/db/analytics';
import { listTxDocuments, updateTxDocuments } from '../src/db/inventory';

describe('Echte Monatsbilanz', () => {
  it('legt Jahresverträge anteilig um und trennt Fix- von Flexkosten', async () => {
    const b = await newBook();
    const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 0 });
    const strom = saveContract(b, { name: 'Strom', amount: -6000, interval: 'monthly', category_id: cat('Strom'), status: 'confirmed' });
    saveContract(b, { name: 'Hausrat', amount: -12000, interval: 'yearly', status: 'confirmed' });
    saveContract(b, { name: 'Sparplan', amount: -10000, interval: 'monthly', category_id: cat('Sparen & Anlegen'), status: 'confirmed' });
    saveContract(b, { name: 'Rücklagen Jahresrechnungen', amount: -40000, interval: 'monthly', category_id: cat('Sparen & Anlegen'), status: 'confirmed' });
    saveContract(b, { name: 'Alt', amount: -99999, interval: 'monthly', status: 'confirmed', end_date: '2026-09-30' });
    const tx = (date: string, amount: number, category: string, extra: Record<string, unknown> = {}) =>
      saveTransaction(b, { account_id: giro, date, amount, payee: category, category_id: cat(category), autoCategorize: false, ...extra });
    for (const m of ['08', '09', '10']) tx(`2026-${m}-10`, -30000, 'Supermarkt');
    tx('2026-11-01', 250000, 'Gehalt & Lohn');
    tx('2026-11-05', -6000, 'Strom', { recurring_id: strom });
    tx('2026-11-06', -45000, 'Supermarkt');
    tx('2026-11-07', -20000, 'Sparen & Anlegen');

    const v = monthBalance(b, '2026-11', '2026-11-21');
    expect(v.income).toBe(250000);
    expect(v.fixed).toBe(6000 + 1000); // Hausrat 120 €/Jahr = 10 €/Monat, beendeter Vertrag zählt nicht
    expect(v.fixedBooked).toBe(6000);
    expect(v.flex).toBe(45000); // Sparen zählt nicht als Flexkosten
    expect(v.savingPlans).toBe(10000); // Sparverträge zählen nicht als Fixkosten, die Rücklage gar nicht (Umlage deckt sie ab)
    expect(v.flexAvg).toBe(30000);
    expect(v.incomeExpected).toBe(0); // Vormonate ohne Einnahmen
    expect(v.free).toBe(250000 - 7000 - 10000 - 45000);
    expect(v.daysLeft).toBe(10); // 21. bis 30.
    expect(v.perDay).toBe(Math.floor(188000 / 10));
    // nicht verknüpfte Abbuchung mit Vertragskategorie und passendem Betrag zählt als Fixkosten, nicht doppelt
    tx('2026-11-08', -6300, 'Strom');
    const w = monthBalance(b, '2026-11', '2026-11-21');
    expect(w.fixedBooked).toBe(12300);
    expect(w.flex).toBe(45000);
    // erwartete Einnahmen im laufenden Monat
    tx('2026-10-28', 300000, 'Gehalt & Lohn');
    tx('2026-09-28', 300000, 'Gehalt & Lohn');
    tx('2026-08-28', 300000, 'Gehalt & Lohn');
    expect(monthBalance(b, '2026-11', '2026-11-21').incomeExpected).toBe(50000);
    expect(monthBalance(b, '2026-11', '2026-12-01').incomeExpected).toBe(0);
    expect(monthBalance(b, '2026-10', '2026-11-21').daysLeft).toBeNull();
  });
});

describe('Belege an Buchungen', () => {
  it('anhängen, entfernen und beim Löschen der Buchung aufräumen', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 0 });
    const id = saveTransaction(b, { account_id: giro, date: '2026-11-20', amount: -1234, payee: 'Markt' });
    const file = (n: string) => ({ filename: n, mime: 'image/png', data: new Uint8Array([1, 2, 3]) });
    updateTxDocuments(b, id, [file('bon.png'), file('rechnung.png')], []);
    const docs = listTxDocuments(b, id);
    expect(docs.map((d) => d.filename)).toEqual(['bon.png', 'rechnung.png']);
    expect(listTransactions(b, {})[0].doc_count).toBe(2);
    updateTxDocuments(b, id, [], [docs[0].id]);
    expect(listTxDocuments(b, id)).toHaveLength(1);
    expect(b.value<number>('select count(*) from documents')).toBe(1);
    deleteTransaction(b, id);
    expect(b.value<number>('select count(*) from documents')).toBe(0);
  });
});
