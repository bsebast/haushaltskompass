import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, deleteTransaction, listTransactions, saveTransfer } from '../src/db/repo';
import { saveContract, listContracts } from '../src/db/contracts';
import {
  detectContracts, acceptSuggestion, dismissSuggestion, priceChanges, updateContractAmount, parseNotice, cancellation,
  upcomingDeadlines, cancellationLetter, markCancelled, insuranceCheck, addMonthsToDate,
} from '../src/db/contractCheck';
import {
  saveCollection, listCollections, addToCollection, removeFromCollection, setTxCollections, collectionIds, collectionByCategory, deleteCollection,
} from '../src/db/collections';

async function setup() {
  const b = await newBook();
  const giro = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 0 });
  const tx = (date: string, amount: number, payee: string, extra: Record<string, unknown> = {}) =>
    saveTransaction(b, { account_id: giro, date, amount, payee, autoCategorize: false, ...extra });
  return { b, giro, tx };
}

describe('Vertragserkennung', () => {
  it('erkennt monatliche und jährliche Abbuchungen ohne Vertrag, nicht aber den Supermarkt', async () => {
    const { b, tx } = await setup();
    for (const m of ['07', '08', '09', '10', '11']) tx(`2026-${m}-03`, -1299, 'NETFLIX.COM 12345');
    tx('2025-03-15', -8900, 'ADAC Mitgliedschaft');
    tx('2026-03-14', -9400, 'ADAC Mitgliedschaft');
    for (let d = 1; d <= 20; d += 3) tx(`2026-11-${String(d).padStart(2, '0')}`, -4000 - d * 100, 'REWE Markt');
    const s = detectContracts(b, '2026-11-20');
    expect(s.map((x) => [x.payee, x.interval, x.amount])).toEqual([
      ['NETFLIX.COM 12345', 'monthly', -1299],
      ['ADAC Mitgliedschaft', 'yearly', -9400],
    ]);

    const id = acceptSuggestion(b, s[0], 'Netflix');
    const c = listContracts(b).find((x) => x.id === id)!;
    expect(c).toMatchObject({ name: 'Netflix', interval: 'monthly', amount: -1299, due_day: 3 });
    expect(listTransactions(b, { recurringId: id })).toHaveLength(5);

    dismissSuggestion(b, s[1]);
    expect(detectContracts(b, '2026-11-20')).toHaveLength(0);
    expect(listContracts(b)).toHaveLength(1); // abgelehnte Vorschläge sind keine Verträge
  });

  it('abgerissene Reihen und vorhandene Verträge werden nicht vorgeschlagen', async () => {
    const { b, tx } = await setup();
    for (const m of ['01', '02', '03', '04']) tx(`2026-${m}-10`, -999, 'Altes Abo');
    for (const m of ['08', '09', '10', '11']) tx(`2026-${m}-10`, -2500, 'Fitnessstudio XY');
    saveContract(b, { name: 'Fitnessstudio', amount: -2500, interval: 'monthly' });
    expect(detectContracts(b, '2026-11-20')).toHaveLength(0);
  });
});

describe('Preisänderungen', () => {
  it('meldet die letzte abweichende Zahlung mit Mehrkosten im Jahr', async () => {
    const { b, tx } = await setup();
    const id = saveContract(b, { name: 'Spotify', amount: -1099, interval: 'monthly' });
    tx('2026-08-01', -1099, 'Spotify AB');
    tx('2026-09-01', -1099, 'Spotify AB');
    tx('2026-10-01', -1299, 'Spotify AB');
    const [p] = priceChanges(b, '2026-11-20');
    expect(p).toMatchObject({ previous: -1099, current: -1299, date: '2026-10-01', perYear: -2400, contractOutdated: true });
    updateContractAmount(b, id, -1299);
    expect(priceChanges(b, '2026-11-20')[0].contractOutdated).toBe(false);
    expect(priceChanges(b, '2027-06-01')).toHaveLength(0); // zu lange her
  });

  it('ordnet Zahlungen bei mehreren Verträgen derselben Gegenseite dem nächstliegenden Betrag zu', async () => {
    const { b, tx } = await setup();
    saveContract(b, { name: 'Barmenia', purpose: 'Hausrat', amount: -1500, interval: 'monthly' });
    saveContract(b, { name: 'Barmenia', purpose: 'Unfall', amount: -1900, interval: 'monthly' });
    for (const m of ['09', '10', '11']) { tx(`2026-${m}-01`, -1500, 'Barmenia Versicherung'); tx(`2026-${m}-02`, -1900, 'Barmenia Versicherung'); }
    expect(priceChanges(b, '2026-11-20')).toHaveLength(0);
  });
});

describe('Kündigungsfristen', () => {
  it('liest Fristen', () => {
    expect(parseNotice('3 Monate')).toEqual({ anytime: false, months: 3, days: 0, monthEnd: false });
    expect(parseNotice('1 Monat zum Monatsende')).toMatchObject({ months: 1, monthEnd: true });
    expect(parseNotice('4 Wochen')).toMatchObject({ days: 28 });
    expect(parseNotice('14 Tage')).toMatchObject({ days: 14 });
    expect(parseNotice('sofort')?.anytime).toBe(true);
    expect(parseNotice('')).toBeNull();
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('berechnet den spätesten Kündigungstag ab Vertragsbeginn', async () => {
    const { b } = await setup();
    saveContract(b, { name: 'Hausrat', amount: -12000, interval: 'yearly', start_date: '2024-01-01', notice_period: '3 Monate' });
    saveContract(b, { name: 'Handy', amount: -2000, interval: 'monthly', start_date: '2025-03-15', term_months: 24, notice_period: '1 Monat' });
    saveContract(b, { name: 'Zeitung', amount: -3000, interval: 'monthly', notice_period: '4 Wochen' });
    const [handy, h, z] = listContracts(b).sort((a, c) => a.name.localeCompare(c.name)).map((c) => cancellation(c, '2026-09-01'));
    expect(handy).toMatchObject({ termEnd: '2027-03-14', deadline: '2027-02-14' });
    expect(h).toMatchObject({ termEnd: '2026-12-31', deadline: '2026-09-30', daysLeft: 29 });
    expect(z.missing).toBe('Vertragsbeginn fehlt');
    // nach dem Stichtag gilt das nächste Jahr
    const later = cancellation(listContracts(b).find((c) => c.name === 'Hausrat')!, '2026-10-01');
    expect(later).toMatchObject({ termEnd: '2027-12-31', deadline: '2027-09-30' });
    expect(upcomingDeadlines(b, 60, '2026-09-01').map((x) => x.contract.name)).toEqual(['Hausrat']);
    markCancelled(b, listContracts(b).find((c) => c.name === 'Hausrat')!, '2026-12-31', '2026-09-02');
    const hr = listContracts(b).find((c) => c.name === 'Hausrat')!;
    expect(hr.end_date).toBe('2026-12-31');
    expect(hr.note).toContain('gekündigt am 02.09.2026');
    expect(upcomingDeadlines(b, 60, '2026-09-01')).toHaveLength(0);
  });

  it('schreibt ein Kündigungsschreiben', () => {
    const t = cancellationLetter({
      sender: { name: 'Max Muster', street: 'Weg 1', city: '12345 Musterstadt' }, recipient: 'Anbieter GmbH\nPostfach 1\n54321 Ort',
      contractName: 'Hausrat', customerNo: 'K-42', mode: 'date', date: '2026-12-31', today: '2026-09-02',
    });
    expect(t).toContain('Musterstadt, 02.09.2026');
    expect(t).toContain('Kündigung Hausrat, Kunden-/Vertragsnummer K-42');
    expect(t).toContain('fristgerecht zum 31.12.2026');
    const s = cancellationLetter({ sender: { name: 'A', street: '', city: '' }, recipient: 'B', contractName: 'Strom', mode: 'special', reason: 'Preiserhöhung' });
    expect(s).toContain('außerordentlich');
    expect(s).toContain('Grund: Preiserhöhung');
  });
});

describe('Versicherungs-Check', () => {
  it('ordnet Verträge den üblichen Versicherungsarten zu', async () => {
    const { b } = await setup();
    saveContract(b, { name: 'Barmenia', purpose: 'Haftpflicht', kind: 'Versicherung', amount: -6000, interval: 'yearly' });
    saveContract(b, { name: 'Heidelberger Leben', purpose: 'BU', kind: 'Versicherung', amount: -5000, interval: 'monthly' });
    saveContract(b, { name: 'Würzburger', purpose: 'Auslandsreisekranken', kind: 'Versicherung', amount: -1500, interval: 'yearly' });
    saveContract(b, { name: 'KFZ', purpose: 'Golf', kind: 'Versicherung', amount: -40000, interval: 'yearly' });
    saveContract(b, { name: 'Netflix', amount: -1299, interval: 'monthly' });
    const r = Object.fromEntries(insuranceCheck(b).map((x) => [x.type.id, x.contracts.map((c) => c.name)]));
    expect(r.haftpflicht).toEqual(['Barmenia']);
    expect(r.bu).toEqual(['Heidelberger Leben']);
    expect(r.reise).toEqual(['Würzburger']);
    expect(r.kranken).toEqual([]); // Auslandsreisekranken zählt als Reise
    expect(r.kfz).toEqual(['KFZ']);
    expect(r.hausrat).toEqual([]);
  });
});

describe('Sammlungen', () => {
  it('bündelt Buchungen mit Summen, Umbuchungen beidseitig, Löschen lässt Buchungen stehen', async () => {
    const { b, giro, tx } = await setup();
    const tg = saveAccount(b, { name: 'Bar', type: 'cash', opening_balance: 0 });
    const id = saveCollection(b, { name: ' Urlaub ' });
    const a = tx('2026-08-01', -50000, 'Hotel');
    const c = tx('2026-08-03', -8000, 'Restaurant');
    const r = tx('2026-08-20', 10000, 'Erstattung');
    saveTransfer(b, { from_account: giro, to_account: tg, date: '2026-08-02', amount: 20000, note: null });
    const tr = listTransactions(b, { kind: 'transfer' }).find((t) => t.account_id === giro)!;
    addToCollection(b, id, [a, c, r, tr.id]);
    const [col] = listCollections(b);
    expect(col).toMatchObject({ name: 'Urlaub', count: 5, expense: -58000, income: 10000, first: '2026-08-01', last: '2026-08-20', color: 's1' });
    expect(listTransactions(b, { collectionId: id })).toHaveLength(5);
    expect(collectionByCategory(b, id).reduce((s, x) => s + x.amount, 0)).toBe(-48000);
    removeFromCollection(b, id, [c]);
    expect(listCollections(b)[0].count).toBe(4);
    const id2 = saveCollection(b, { name: 'Steuer' });
    setTxCollections(b, a, [id2]);
    expect(collectionIds(b, a)).toEqual([id2]);
    deleteTransaction(b, r);
    expect(listCollections(b).find((x) => x.id === id)!.count).toBe(2);
    deleteCollection(b, id);
    expect(listTransactions(b, {}).length).toBeGreaterThan(0);
    expect(() => saveCollection(b, { name: '  ' })).toThrow(/Namen/);
  });
});
