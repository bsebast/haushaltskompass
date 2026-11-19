import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { parseBankCsv, commitBankImport, planBankImport } from '../src/db/bankcsv';
import {
  saveAccount, saveTransaction, saveTransfer, deleteTransaction, listAccounts, linkCounterpart,
  findMissingCounterparts, applyMissingCounterparts, AUTO_COUNTERPART_NOTE,
} from '../src/db/repo';

// frei erfundene Daten im Aufbau des Volksbank-Exports
const HEAD = 'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz';
const GIRO = 'DE00111111110000000001';
const SPAR = 'DE00222222220000000002';
const csv = (own: string, rows: [string, string, string, string, string, string][]) =>
  [HEAD, ...rows.map(([d, payee, iban, purpose, amount, saldo]) => `Konto;${own};BIC;Musterbank;${d};${d};${payee};${iban};BIC;Überweisung;${purpose};${amount};EUR;${saldo};;;;`)].join('\r\n');
const tx = (b: Awaited<ReturnType<typeof newBook>>, acc: string) =>
  b.all<{ id: string; date: string; amount: number; transfer_id: string | null; auto_counterpart: number; import_hash: string | null; note: string | null }>(
    'select id, date, amount, transfer_id, auto_counterpart, import_hash, note from transactions where account_id = ? order by date, amount', [acc]);
const bal = (b: Awaited<ReturnType<typeof newBook>>, id: string) => listAccounts(b, true).find((a) => a.id === id)!.balance;

describe('Gegenbuchungen', () => {
  it('Import: Überweisung an eigenes Konto legt die Gegenbuchung an, der spätere Import des Gegenkontos ersetzt sie', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', iban: GIRO });
    const spar = saveAccount(b, { name: 'Spar', type: 'savings', iban: SPAR });
    const g = parseBankCsv(csv(GIRO, [
      ['03.03.2026', 'Max Muster', SPAR, 'Sparen', '-100,00', '900,00'],
      ['01.03.2026', 'Arbeitgeber', 'DE00999', 'Gehalt', '1.000,00', '1.000,00'],
    ]));
    const p = planBankImport(b, g, giro);
    expect(p.autoCounterparts).toBe(1);
    const r = commitBankImport(b, g, { accountId: giro });
    expect(r).toMatchObject({ imported: 2, transfers: 1, autoCreated: 1 });
    const auto = tx(b, spar);
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({ amount: 10000, auto_counterpart: 1, note: AUTO_COUNTERPART_NOTE });
    expect(auto[0].transfer_id).toBe(tx(b, giro).find((t) => t.amount === -10000)!.transfer_id);
    expect(bal(b, spar)).toBe(10000);

    // Sparkonto später importieren: die Bank bucht einen Tag später
    const s = parseBankCsv(csv(SPAR, [['04.03.2026', 'Max Muster', GIRO, 'Sparen', '100,00', '600,00']]));
    const p2 = planBankImport(b, s, spar);
    expect(p2.rows[0].status).toBe('replace');
    const r2 = commitBankImport(b, s, { accountId: spar });
    expect(r2).toMatchObject({ imported: 0, replaced: 1 });
    const after = tx(b, spar);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ date: '2026-03-04', auto_counterpart: 0, transfer_id: auto[0].transfer_id });
    expect(after[0].import_hash).toMatch(/^bank:/);
    expect(bal(b, spar)).toBe(60000);
    // nochmals importieren: nichts Neues
    expect(planBankImport(b, s, spar).newCount).toBe(0);
  });

  it('keine erfundene Gegenbuchung, wenn das Gegenkonto für den Tag schon importiert ist', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', iban: GIRO });
    const spar = saveAccount(b, { name: 'Spar', type: 'savings', iban: SPAR });
    commitBankImport(b, parseBankCsv(csv(SPAR, [['01.03.2026', 'Zinsen', 'DE00999', 'Zins', '1,00', '1,00'], ['31.03.2026', 'Zinsen', 'DE00999', 'Zins', '1,00', '2,00']])), { accountId: spar });
    const r = commitBankImport(b, parseBankCsv(csv(GIRO, [['10.03.2026', 'Max Muster', SPAR, 'Sparen', '-100,00', '900,00']])), { accountId: giro });
    expect(r.autoCreated).toBe(0);
    expect(tx(b, spar)).toHaveLength(2);
    const m = findMissingCounterparts(b);
    expect(m).toHaveLength(1);
    expect(m[0].action).toBe('skip');
  });

  it('ergänzt fehlende Gegenbuchungen für ältere Importe über die nachgetragene IBAN', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', iban: GIRO });
    const file = csv(GIRO, [['05.03.2026', 'Max Muster', SPAR, 'Sparen', '-50,00', '950,00'], ['06.03.2026', 'Max Muster', SPAR, 'Sparen', '-20,00', '930,00']]);
    commitBankImport(b, parseBankCsv(file), { accountId: giro });
    // Sparkonto erst danach angelegt, ältere Buchungen ohne Gegen-IBAN simulieren
    const spar = saveAccount(b, { name: 'Spar', type: 'savings', iban: SPAR });
    b.run('update transactions set counter_iban = null');
    expect(findMissingCounterparts(b)).toHaveLength(0);
    commitBankImport(b, parseBankCsv(file), { accountId: giro }); // erneuter Import trägt die IBAN nach
    saveTransaction(b, { account_id: spar, date: '2026-03-07', amount: 2000, payee: 'Eingang', autoCategorize: false });
    const m = findMissingCounterparts(b);
    expect(m.map((x) => x.action)).toEqual(['create', 'link']);
    expect(applyMissingCounterparts(b, m)).toEqual({ linked: 1, created: 1 });
    expect(tx(b, spar).map((t) => [t.amount, t.auto_counterpart, !!t.transfer_id])).toEqual([[5000, 1, true], [2000, 0, true]]);
    expect(findMissingCounterparts(b)).toHaveLength(0);
  });

  it('Buchung von Hand zur Umbuchung machen, ändern und löschen geht auf beiden Seiten', async () => {
    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking' });
    const spar = saveAccount(b, { name: 'Spar', type: 'savings' });
    const id = saveTransaction(b, { account_id: giro, date: '2026-03-05', amount: -5000, payee: 'Bank', import_hash: 'bank:x', autoCategorize: false });
    expect(linkCounterpart(b, id, spar)).toMatchObject({ created: true });
    const tid = tx(b, giro)[0].transfer_id!;
    expect(tx(b, spar)[0]).toMatchObject({ amount: 5000, transfer_id: tid });
    // Ändern über den Umbuchungsdialog: beide Seiten ziehen mit, der Fingerabdruck bleibt
    saveTransfer(b, { transfer_id: tid, from_account: giro, to_account: spar, date: '2026-03-06', amount: 6000, note: null });
    expect(tx(b, giro)[0]).toMatchObject({ id, date: '2026-03-06', amount: -6000, import_hash: 'bank:x' });
    expect(tx(b, spar)[0]).toMatchObject({ date: '2026-03-06', amount: 6000 });
    deleteTransaction(b, tx(b, spar)[0].id);
    expect(tx(b, giro)).toHaveLength(0);
    expect(tx(b, spar)).toHaveLength(0);
  });
});
