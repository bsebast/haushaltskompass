import type { Book } from './core';
import { saveGoal } from './goals';
import { listCategories, saveAccount, saveBudget, saveRule, saveTransaction, saveTransfer } from './repo';
import { addMonths, currentMonth, ymd, daysInMonth, today } from '../lib/dates';

/** Füllt ein neues Haushaltsbuch mit 12 Monaten plausibler Beispieldaten. Deterministisch (fester Seed). */
export function seedDemo(b: Book) {
  let s = 42;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const between = (a: number, z: number) => Math.round(a + rnd() * (z - a));
  const cats = new Map(listCategories(b).map((c) => [c.name, c.id]));
  const c = (n: string) => cats.get(n)!;

  b.tx(() => {
    const giro = saveAccount(b, { name: 'Girokonto', type: 'checking', opening_balance: 185000 });
    const bar = saveAccount(b, { name: 'Bargeld', type: 'cash', opening_balance: 8000 });
    const spar = saveAccount(b, { name: 'Tagesgeld', type: 'savings', opening_balance: 600000 });
    saveAccount(b, { name: 'Kreditkarte', type: 'credit' });

    const rules: [string, string][] = [
      ['rewe', 'Supermarkt'], ['edeka', 'Supermarkt'], ['aldi', 'Supermarkt'], ['lidl', 'Supermarkt'],
      ['dm-drogerie', 'Drogerie'], ['netflix', 'Streaming'], ['spotify', 'Streaming'], ['aral', 'Kraftstoff'],
      ['shell', 'Kraftstoff'], ['stadtwerke', 'Strom'], ['telekom', 'Internet & Telefon'], ['deutsche bahn', 'ÖPNV & Bahn'],
    ];
    rules.forEach(([v, cat]) => saveRule(b, { field: 'any', op: 'contains', value: v, category_id: c(cat) }));

    const end = currentMonth();
    const lastDay = today();
    for (let i = 11; i >= 0; i--) {
      const m = addMonths(end, -i);
      const [y, mo] = m.split('-').map(Number);
      const dim = daysInMonth(m);
      const d = (day: number) => ymd(y, mo, Math.min(day, dim));
      const add = (day: number, amount: number, payee: string, extra: Partial<Parameters<typeof saveTransaction>[1]> = {}) => {
        if (d(day) > lastDay) return;
        saveTransaction(b, { account_id: giro, date: d(day), amount, payee, ...extra });
      };
      add(1, 342000, 'Muster GmbH', { purpose: 'Gehalt', category_id: c('Gehalt & Lohn') });
      add(10, 25500, 'Familienkasse', { purpose: 'Kindergeld', category_id: c('Kindergeld') });
      add(1, -112000, 'Hausverwaltung Berger', { purpose: 'Miete', category_id: c('Miete') });
      add(3, -21500, 'Hausverwaltung Berger', { purpose: 'Nebenkosten-Vorauszahlung', category_id: c('Nebenkosten') });
      add(5, -8900, 'Stadtwerke', { purpose: 'Abschlag Strom' });
      add(7, -3999, 'Telekom Deutschland', { purpose: 'Festnetz und Internet' });
      add(15, -1799, 'Netflix International');
      add(15, -1099, 'Spotify AB');
      add(2, -4850, 'Allianz', { purpose: 'Kfz-Versicherung', category_id: c('Kfz-Versicherung') });
      add(20, -1590, 'Sportverein', { category_id: c('Sport') });
      const shops = ['REWE Markt', 'EDEKA Center', 'ALDI SÜD', 'LIDL'];
      for (let k = 0; k < 9; k++) add(between(1, 28), -between(1800, 9500), shops[between(0, 3)]);
      for (let k = 0; k < 2; k++) add(between(1, 28), -between(4500, 7500), ['ARAL Tankstelle', 'Shell'][k]);
      add(between(1, 28), -between(1200, 3800), 'dm-drogerie markt');
      if (rnd() < 0.7) add(between(1, 28), -between(2500, 9000), 'Trattoria Roma', { category_id: c('Restaurant & Café') });
      if (rnd() < 0.4) add(between(1, 28), -between(3000, 15000), 'Online-Versand', { category_id: c('Kleidung') });
      if (rnd() < 0.3) add(between(1, 28), -between(2000, 9000), 'Apotheke am Markt', { category_id: c('Apotheke') });
      if (mo === 7 || mo === 8) add(12, -between(90000, 160000), 'Reisebüro Sonnenschein', { category_id: c('Urlaub') });
      if (mo === 12) add(10, -between(20000, 40000), 'Spielwarenladen', { category_id: c('Geschenke') });
      // Bargeld
      if (d(4) <= lastDay) saveTransfer(b, { from_account: giro, to_account: bar, date: d(4), amount: 20000 });
      for (let k = 0; k < 5; k++) {
        const day = between(5, 28);
        if (d(day) <= lastDay) saveTransaction(b, { account_id: bar, date: d(day), amount: -between(300, 2500), payee: ['Bäckerei Krume', 'Wochenmarkt', 'Kiosk'][k % 3], category_id: c(k % 3 === 2 ? 'Getränke' : 'Bäcker & Markt') });
      }
      if (d(28) <= lastDay) saveTransfer(b, { from_account: giro, to_account: spar, date: d(28), amount: 30000 });
    }

    const first = addMonths(end, -11);
    saveBudget(b, { category_id: c('Lebensmittel'), period: 'month', amount: 55000, valid_from: first });
    saveBudget(b, { category_id: c('Freizeit'), period: 'month', amount: 15000, valid_from: first });
    saveBudget(b, { category_id: c('Abos & Medien'), period: 'month', amount: 3500, valid_from: first });
    saveBudget(b, { category_id: c('Mobilität'), period: 'month', amount: 20000, valid_from: first });

    const y = Number(end.slice(0, 4)) + 1;
    saveGoal(b, { name: 'Notgroschen', target: 1500000, target_date: null, saved: 0, account_id: spar, color: 's3', note: 'Drei Monatsausgaben als Reserve' });
    saveGoal(b, { name: 'Sommerurlaub', target: 250000, target_date: `${y}-07-15`, saved: 90000, account_id: null, color: 's4', note: null });
    saveGoal(b, { name: 'Neues Fahrrad', target: 120000, target_date: `${y}-04-30`, saved: 30000, account_id: null, color: 's7', note: null });
  });
}
