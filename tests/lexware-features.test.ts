import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, saveTransfer, saveHolding, listCategories, listAccounts } from '../src/db/repo';
import { saveContract, listContracts } from '../src/db/contracts';
import { reportLines, moneyFlow } from '../src/db/analytics';
import {
  forecastBase, computeForecast, summarize, dueIn, contractDelta, loadForecast, saveForecast, newScenario, newAdjustment, DEFAULT_SETTINGS,
} from '../src/db/forecast';
import {
  saveInventory, listInventory, deleteInventory, addDocument, getDocument, valueOf, inventoryTotals, warrantyEndingSoon, inventoryCsv,
} from '../src/db/inventory';
import { setAccountLimits, setHoldingAlerts, listAlerts, unitPrice } from '../src/db/alerts';

async function setup() {
  const b = await newBook();
  const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
  const giro = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 100000 });
  const tg = saveAccount(b, { name: 'Tagesgeld', type: 'savings' });
  const depot = saveAccount(b, { name: 'Depot', type: 'depot' });
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    saveTransaction(b, { account_id: giro, date: `${m}-01`, amount: 300000, payee: 'Firma', category_id: cat('Gehalt & Lohn'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: `${m}-10`, amount: -100000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    // Umbuchung zwischen liquiden Konten zählt nicht, Sparplan ins Depot schon
    saveTransfer(b, { from_account: giro, to_account: tg, date: `${m}-15`, amount: 50000 });
    saveTransfer(b, { from_account: giro, to_account: depot, date: `${m}-20`, amount: 20000 });
  }
  return { b, giro, tg, depot, cat };
}

describe('Finanzprognose', () => {
  it('Durchschnitt aus dem Rückblick, Umbuchungen zwischen den Konten zählen nicht', async () => {
    const { b } = await setup();
    const base = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3, months: 3 }, '2026-11');
    expect(base.historyMonths).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(base.avgIncome).toBe(300000);
    expect(base.avgExpense).toBe(-120000); // Markt + Sparplan ins Depot
    expect(base.start).toBe(100000 + 3 * 180000);
    const rows = computeForecast(base, null);
    expect(rows.map((r) => r.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(rows[1].net).toBe(180000);
    expect(rows[3].balance).toBe(base.start + 4 * 180000);
  });

  it('Jahresverträge erscheinen im Fälligkeitsmonat statt als Zwölftel', async () => {
    const { b, giro } = await setup();
    saveContract(b, { name: 'Kfz-Versicherung', amount: -60000, interval: 'yearly', due_months: [1], account_id: giro, status: 'confirmed' });
    const c = listContracts(b)[0];
    expect(dueIn(c, '2027-01')).toBe(true);
    expect(dueIn(c, '2027-02')).toBe(false);
    const hist = ['2026-08', '2026-09', '2026-10'];
    expect(contractDelta(c, '2027-01', hist)).toBe(-60000 + 5000);
    expect(contractDelta(c, '2027-02', hist)).toBe(5000);
    const base = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3, months: 12 }, '2026-11');
    const rows = computeForecast(base, null);
    const jan = rows.find((r) => r.month === '2027-01')!;
    expect(jan.expense).toBe(-120000 - 55000);
    // über ein Jahr gleicht es sich aus
    const sum = rows.slice(1, 13).reduce((a, r) => a + r.contracts, 0);
    expect(sum).toBe(0);
  });

  it('Neue Verträge kommen ab Beginn dazu, beendete fallen weg', async () => {
    const { b } = await setup();
    saveContract(b, { name: 'Neue Miete', amount: -80000, interval: 'monthly', start_date: '2027-03-01', status: 'confirmed' });
    saveContract(b, { name: 'Alter Kredit', amount: -10000, interval: 'monthly', start_date: '2025-01-01', end_date: '2026-12-31', status: 'confirmed' });
    const hist = ['2026-08', '2026-09', '2026-10'];
    const [neu, alt] = ['Neue Miete', 'Alter Kredit'].map((n) => listContracts(b).find((c) => c.name === n)!);
    expect(contractDelta(neu, '2027-02', hist)).toBe(0);
    expect(contractDelta(neu, '2027-03', hist)).toBe(-80000);
    expect(contractDelta(alt, '2026-12', hist)).toBe(0);
    expect(contractDelta(alt, '2027-01', hist)).toBe(10000);
  });

  it('Szenarien: einmalig, monatlich und prozentual', async () => {
    const { b } = await setup();
    const base = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3, months: 4 }, '2026-11');
    const sc = newScenario('Auto und Gehalt');
    sc.adjustments.push(
      newAdjustment({ label: 'Auto', kind: 'once', amount: -2500000, from: '2027-01' }),
      newAdjustment({ label: 'Rate', kind: 'monthly', amount: -30000, from: '2027-02', to: '2027-02' }),
      newAdjustment({ label: 'Gehalt', kind: 'percent', pct: 10, target: 'income', from: '2027-01' }),
    );
    const rows = computeForecast(base, sc);
    const by = (m: string) => rows.find((r) => r.month === m)!;
    expect(by('2026-12').extra).toBe(0);
    expect(by('2027-01').income).toBe(330000);
    expect(by('2027-01').extra).toBe(-2500000 + 30000);
    expect(by('2027-02').expense).toBe(-150000);
    expect(by('2027-03').expense).toBe(-120000);
    const s = summarize(rows, 0);
    expect(s.belowFloor).toBe('2027-01');
    expect(s.lowMonth).toBe('2027-01');
  });

  it('Große Einzelausgaben zählen als einmalig nicht zum Durchschnitt', async () => {
    const { b, giro, cat } = await setup();
    saveTransaction(b, { account_id: giro, date: '2026-09-23', amount: -1800000, payee: 'Autohaus', category_id: cat('Supermarkt'), autoCategorize: false });
    const off = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3 }, '2026-11');
    expect(off.avgExpense).toBe(-120000);
    expect(off.oneOffs.map((t) => t.payee)).toEqual(['Autohaus']);
    const on = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3, oneOff: null }, '2026-11');
    expect(on.avgExpense).toBe(-720000);
    expect(on.oneOffs).toEqual([]);
  });

  it('Laufender Monat: nur der Rest bis Monatsende', async () => {
    const { b, giro, cat } = await setup();
    saveTransaction(b, { account_id: giro, date: '2026-11-01', amount: 300000, payee: 'Firma', category_id: cat('Gehalt & Lohn'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-11-05', amount: -40000, payee: 'Markt', category_id: cat('Supermarkt'), autoCategorize: false });
    const base = forecastBase(b, { ...DEFAULT_SETTINGS, history: 3, months: 2 }, '2026-11');
    const nov = computeForecast(base, null)[0];
    expect(nov.income).toBe(0);
    expect(nov.expense).toBe(-80000);
  });

  it('Einstellungen und Szenarien werden im Haushaltsbuch gespeichert', async () => {
    const { b, giro } = await setup();
    const cfg = loadForecast(b);
    expect(cfg.settings.months).toBe(24);
    saveForecast(b, { settings: { ...cfg.settings, accountIds: [giro], floor: 50000 }, scenarios: [newScenario('Test')] });
    const again = loadForecast(b);
    expect(again.settings.accountIds).toEqual([giro]);
    expect(again.scenarios[0].name).toBe('Test');
    expect(forecastBase(b, again.settings, '2026-11').accountIds).toEqual([giro]);
  });
});

describe('Geldfluss', () => {
  it('Einnahmen fließen über den Topf zu Ausgaben und Überschuss', async () => {
    const { b } = await setup();
    const lines = reportLines(b, { from: '2026-08-01', to: '2026-10-31' });
    const f = moneyFlow(lines, listCategories(b));
    const names = f.nodes.map((n) => n.name);
    expect(names).toContain('Verfügbares Geld');
    expect(names).toContain('Überschuss');
    expect(f.income).toBe(900000);
    const hub = f.nodes.findIndex((n) => n.side === 'hub');
    const inSum = f.links.filter((l) => l.target === hub).reduce((a, l) => a + l.value, 0);
    const outSum = f.links.filter((l) => l.source === hub).reduce((a, l) => a + l.value, 0);
    expect(inSum).toBe(outSum);
  });

  it('Mehr Ausgaben als Einnahmen: Rest kommt aus Rücklagen', async () => {
    const b = await newBook();
    const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
    const giro = saveAccount(b, { name: 'Giro', type: 'checking' });
    saveTransaction(b, { account_id: giro, date: '2026-01-01', amount: 1000, payee: 'X', category_id: cat('Gehalt & Lohn'), autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-01-02', amount: -5000, payee: 'Y', category_id: cat('Supermarkt'), autoCategorize: false });
    const f = moneyFlow(reportLines(b, { from: '2026-01-01', to: '2026-01-31' }), listCategories(b));
    expect(f.nodes.find((n) => n.root === '#deficit')?.amount).toBe(4000);
    expect(f.nodes.some((n) => n.root === '#surplus')).toBe(false);
  });
});

describe('Inventar', () => {
  it('Zeitwert: von Hand, linear oder Kaufpreis', () => {
    expect(valueOf({ current_value: 5000, purchase_price: 100000, purchase_date: '2020-01-01', useful_life: 5 })).toBe(5000);
    expect(valueOf({ current_value: null, purchase_price: 100000, purchase_date: '2026-01-01', useful_life: 4 }, '2028-01-01')).toBe(50000);
    expect(valueOf({ current_value: null, purchase_price: 100000, purchase_date: '2010-01-01', useful_life: 4 }, '2028-01-01')).toBe(0);
    expect(valueOf({ current_value: null, purchase_price: 100000, purchase_date: null, useful_life: null })).toBe(100000);
  });

  it('Speichern, Beleg, Summen, CSV und Löschen', async () => {
    const b = await newBook();
    const doc = addDocument(b, 'rechnung.pdf', 'application/pdf', new Uint8Array([1, 2, 3]));
    const id = saveInventory(b, {
      name: 'Fernseher', category: 'Elektronik', room: 'Wohnzimmer', owner: null, purchase_date: '2026-01-10', purchase_price: 120000, current_value: null,
      useful_life: null, serial: 'AB1', warranty_until: '2026-12-01', insurance: 'Hausrat', note: null, document_id: doc,
    });
    saveInventory(b, {
      name: 'Fahrrad', category: 'Fahrrad', room: 'Keller', owner: 'Anna', purchase_date: null, purchase_price: 80000, current_value: 50000,
      useful_life: null, serial: null, warranty_until: null, insurance: null, note: 'mit "Korb"; blau', document_id: null,
    });
    const items = listInventory(b);
    expect(items).toHaveLength(2);
    expect(items.find((x) => x.id === id)?.doc_name).toBe('rechnung.pdf');
    expect(getDocument(b, doc)?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(inventoryTotals(items)).toEqual({ price: 200000, value: 170000 });
    expect(warrantyEndingSoon(items.find((x) => x.id === id)!, 60, '2026-11-21')).toBe(true);
    expect(warrantyEndingSoon(items.find((x) => x.id === id)!, 60, '2026-12-02')).toBe(false);
    const csv = inventoryCsv(items);
    expect(csv).toContain('Fernseher;Elektronik;Wohnzimmer;;10.01.2026;1200,00;1200,00');
    expect(csv).toContain('"mit ""Korb""; blau"');
    deleteInventory(b, id);
    expect(listInventory(b)).toHaveLength(1);
    expect(getDocument(b, doc)).toBeNull();
  });

  it('Pflichtfeld und Nutzungsdauer werden geprüft', async () => {
    const b = await newBook();
    const base = { category: null, room: null, owner: null, purchase_date: null, purchase_price: null, current_value: null, serial: null, warranty_until: null, insurance: null, note: null, document_id: null };
    expect(() => saveInventory(b, { ...base, name: ' ', useful_life: null })).toThrow();
    expect(() => saveInventory(b, { ...base, name: 'X', useful_life: 0 })).toThrow();
  });
});

describe('Warngrenzen', () => {
  it('Kontostand unter oder über der Grenze', async () => {
    const { b, giro, tg } = await setup();
    setAccountLimits(b, giro, 1000000, null); // Giro liegt darunter
    setAccountLimits(b, tg, null, 100000); // Tagesgeld 150.000 liegt darüber
    const a = listAlerts(b);
    expect(a.map((x) => [x.name, x.dir])).toEqual([['Giro', 'below'], ['Tagesgeld', 'above']]);
    expect(listAccounts(b).find((x) => x.id === giro)?.min_balance).toBe(1000000);
    expect(() => setAccountLimits(b, giro, 10, 5)).toThrow();
    setAccountLimits(b, giro, null, null);
    setAccountLimits(b, tg, null, null);
    expect(listAlerts(b)).toEqual([]);
  });

  it('Kursgrenze je Depotposition', async () => {
    const { b, depot } = await setup();
    const h = saveHolding(b, { account_id: depot, owner: null, wkn: null, isin: 'DE0001', name: 'Fonds', quantity: 10, cost_value: 100000, price: null, market_value: 90000, as_of: '2026-11-20' });
    expect(unitPrice({ price: null, market_value: 90000, quantity: 10 })).toBe(9000);
    setHoldingAlerts(b, h, 9500, null);
    expect(listAlerts(b)).toMatchObject([{ kind: 'holding', name: 'Fonds', dir: 'below', value: 9000, limit: 9500 }]);
    setHoldingAlerts(b, h, null, 8000);
    expect(listAlerts(b)[0].dir).toBe('above');
  });
});
