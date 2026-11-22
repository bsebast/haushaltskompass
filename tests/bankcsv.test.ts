import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { parseBankCsv, planBankImport, commitBankImport, suggestAccount, cleanPurpose } from '../src/db/bankcsv';
import { pendingSuggestedRules } from '../src/db/ruleSuggestions';
import { listAccounts, listCategories, listSnapshots, listTransactions, saveAccount, saveSnapshot, saveTransaction } from '../src/db/repo';
import { saveContract } from '../src/db/contracts';

// Musterdaten im Format des Volksbank-Exports (frei erfunden), neueste Buchung zuerst
const HEAD = 'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz';
const row = (date: string, payee: string, text: string, purpose: string, amount: string, saldo: string) =>
  `Giro;DE00123456780000000001;GENODEXXX;Musterbank eG;${date};${date};${payee};DE001;BIC;${text};${purpose};${amount};EUR;${saldo};;;;`;
const CSV = '﻿' + [
  HEAD,
  row('05.03.2026', 'PayPal Europe S.a.r.l. et Cie S.C.A', 'Basislastschrift', '1234/PP.1.PP/. Buchladen GmbH, Ihr Einkauf bei Buchladen GmbH EREF: 1 MREF: 2 CRED: 3', '-20,00', '1.430,00'),
  row('03.03.2026', 'Netflix Services Germany GmbH', 'Basislastschrift', 'Netflix Monatsabo EREF: 9', '-13,99', '1.450,00'),
  row('03.03.2026', 'Muster Versicherung AG', 'Basislastschrift', 'Beitrag Haftpflicht', '-7,36', '1.463,99'),
  row('02.03.2026', 'Arbeitgeber GmbH', 'LOHN-/GEHALT-/RENTEN', 'Gehalt Maerz', '1.000,00', '1.471,35'),
  row('01.03.2026', 'DANKE EDEKA MUSTERMANN', 'Kartenzahlung girocard', 'EDEKA MUSTERMANN/ORT', '-28,65', '471,35'),
  row('01.03.2026', '', 'ABSCHLUSS', 'Abschluss lt. Anlage', '-12,90', '500,00'),
].join('\r\n') + '\r\n';

describe('Bank-CSV-Import', () => {
  it('liest den Volksbank-Export', () => {
    const st = parseBankCsv(CSV);
    expect(st.iban).toBe('DE00123456780000000001');
    expect(st.rows).toHaveLength(6);
    expect(st.from).toBe('2026-03-01');
    expect(st.to).toBe('2026-03-05');
    expect(st.endBalance).toBe(143000);
    expect(st.startBalance).toBe(51290);
    expect(st.warnings).toEqual([]);
    expect(st.rows[0].payee).toBe('Musterbank eG'); // leerer Empfänger → Bank
    expect(st.rows[5].payee).toBe('Buchladen GmbH (PayPal)');
    expect(st.rows[5].purpose).toBe('1234/PP.1.PP/. Buchladen GmbH, Ihr Einkauf bei Buchladen GmbH');
    expect(cleanPurpose('Text EREF: 1 MREF: 2')).toBe('Text');
  });

  it('meldet Lücken im Saldo', () => {
    const broken = CSV.replace('1.450,00', '1.449,00');
    expect(parseBankCsv(broken).warnings[0]).toMatch(/Saldo passt/);
  });

  it('kategorisiert über Regeln und Verträge, erkennt Dubletten und gleicht Kontostände an', async () => {
    const b = await newBook();
    const acc = saveAccount(b, { name: 'Mein Konto', type: 'checking', bank: 'Musterbank' });
    saveSnapshot(b, acc, '2026-03-02', 147000); // weicht um 1,35 € vom Saldo der Bank ab
    saveSnapshot(b, acc, '2026-03-03', 145000); // passt
    const haft = listCategories(b).find((c) => c.name === 'Haftpflicht')!.id;
    const contract = saveContract(b, { name: 'Muster Versicherung', amount: -736, interval: 'monthly', category_id: haft, status: 'confirmed' });
    saveTransaction(b, { account_id: acc, date: '2026-03-04', amount: -1399, payee: 'Netflix', autoCategorize: false }); // von Hand erfasst

    const st = parseBankCsv(CSV);
    expect(suggestAccount(b, st)).toBe(acc);
    const extra = pendingSuggestedRules(b);
    const plan = planBankImport(b, st, acc, extra);
    expect(plan.newCount).toBe(5);
    expect(plan.possible).toBe(1);
    expect(plan.contracts).toBe(1);
    const byPayee = (p: string) => plan.rows.find((r) => r.payee.startsWith(p))!;
    const cat = (id: string | null) => listCategories(b).find((c) => c.id === id)?.name;
    expect(cat(byPayee('DANKE EDEKA').categoryId)).toBe('Supermarkt');
    expect(cat(byPayee('Arbeitgeber').categoryId)).toBe('Gehalt & Lohn');
    expect(cat(byPayee('Musterbank').categoryId)).toBe('Bankgebühren');
    expect(byPayee('Muster Versicherung').categorySource).toBe('contract');
    expect(byPayee('Netflix').status).toBe('possible');
    expect(plan.snapshotFixes).toEqual([{ date: '2026-03-02', old: 147000, bank: 147135 }]);

    const res = commitBankImport(b, st, { accountId: acc, extraRules: extra });
    expect(res.imported).toBe(5);
    expect(res.balance).toBe(143000);
    const tx = listTransactions(b, { accountId: acc });
    expect(tx).toHaveLength(6);
    expect(tx.find((t) => t.payee === 'Muster Versicherung AG')?.recurring_id).toBe(contract);
    expect(listSnapshots(b, acc).map((s) => [s.date, s.balance])).toEqual(expect.arrayContaining([
      ['2026-02-28', 51290], ['2026-03-02', 147135], ['2026-03-03', 145000], ['2026-03-05', 143000],
    ]));
    expect(listAccounts(b).find((a) => a.id === acc)?.iban).toBe('DE00123456780000000001');

    // zweiter Import derselben Datei: alles schon da
    const again = planBankImport(b, parseBankCsv(CSV), acc);
    expect(again.newCount).toBe(0);
    expect(again.duplicates).toBe(5);
    expect(suggestAccount(b, st)).toBe(acc); // jetzt über die IBAN
  });

  it('legt bei Bedarf ein neues Konto an', async () => {
    const b = await newBook();
    const st = parseBankCsv(CSV);
    const res = commitBankImport(b, st, { accountId: null });
    const a = listAccounts(b).find((x) => x.id === res.accountId)!;
    expect(a.name).toBe('Giro');
    expect(a.bank).toBe('Musterbank eG');
    expect(res.imported).toBe(6);
    expect(a.balance).toBe(143000);
  });
});

// Musterdaten im Format des comdirect-Exports (frei erfunden)
const COMDIRECT = [
  ';',
  '"Umsätze Girokonto";"Zeitraum: 01.03.2026 - 31.03.2026";',
  '"Neuer Kontostand";"1.270,00 EUR";',
  '',
  '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
  '"offen";"31.03.2026";"Lastschrift / Belastung";"Auftraggeber: CAFE Buchungstext: CAFE Ref. X0";"-3,00";',
  '"20.03.2026";"22.03.2026";"Wertpapiere";" Buchungstext: MUSTER ETF WPKNR: A0 ISIN: IE000 Ref. W1/2";"-500,00";',
  '"10.03.2026";"10.03.2026";"Kupon";" Buchungstext: ERTRAEGNISGUTSCHRIFT VOM 10.03.26 MUSTER FONDS Ref. K1/2";"20,00";',
  '"05.03.2026";"05.03.2026";"Übertrag / Überweisung - Echtzeit";"Empfänger: Max MusterKto/IBAN: DE00123456780000000001 BLZ/BIC: GENODEXXX  Ref. U2/1";"-50,00";',
  '"02.03.2026";"02.03.2026";"Übertrag / Überweisung - Echtzeit";"Auftraggeber: Max Muster Buchungstext: Uebertrag auf Girokonto Ref. U1/1";"200,00";',
  '"02.03.2026";"02.03.2026";"Lastschrift / Belastung";"Auftraggeber: EDEKA MUSTER Buchungstext: EDEKA MUSTER, ORT DE Karte Nr. 4871 78XX XXXX 0000 Kartenzahlung comdirect Visa-Debitkarte 2026-03-01 Ref. C1/1";"-10,00";',
  '"02.03.2026";"02.03.2026";"Lastschrift / Belastung";"Auftraggeber: EDEKA MUSTER Buchungstext: EDEKA MUSTER, ORT DE Karte Nr. 4871 78XX XXXX 0000 Kartenzahlung comdirect Visa-Debitkarte 2026-03-01 Ref. C2/1";"-10,00";',
  '',
  '"Alter Kontostand";"1.620,00 EUR";',
  '',
].join('\r\n');

describe('comdirect-Import', () => {
  it('liest Kopf, Fuß und die zusammengefasste Textspalte', () => {
    const st = parseBankCsv(COMDIRECT);
    expect(st.bank).toBe('comdirect');
    expect(st.accountName).toBe('Girokonto');
    expect(st.rows).toHaveLength(6);
    expect(st.startBalance).toBe(162000);
    expect(st.endBalance).toBe(127000);
    expect(st.warnings).toEqual(['1 vorgemerkte, noch nicht gebuchte Umsätze werden nicht übernommen']);
    const edeka = st.rows.filter((r) => r.payee === 'EDEKA MUSTER');
    expect(edeka).toHaveLength(2);
    expect(edeka[0].purpose).toBe('EDEKA MUSTER, ORT DE');
    expect(new Set(edeka.map((r) => r.hash)).size).toBe(2);
    const out = st.rows.find((r) => r.amount === -5000)!;
    expect(out.counterIban).toBe('DE00123456780000000001');
    expect(out.payee).toBe('Max Muster');
    expect(st.rows.find((r) => r.amount === -50000)!.securities).toBe(true);
    expect(st.dayEnd.get('2026-03-02')).toBe(180000);
  });

  it('verknüpft Überweisungen mit der Gegenbuchung und bucht Wertpapiere zum Depot', async () => {
    const b = await newBook();
    // zuerst das Volksbank-Konto mit seinen Buchungen
    const vb = parseBankCsv(CSV);
    const vbRes = commitBankImport(b, vb, { accountId: null });
    saveTransaction(b, { account_id: vbRes.accountId, date: '2026-03-02', amount: -20000, payee: 'Max Muster', purpose: 'Sparen', autoCategorize: false });
    saveTransaction(b, { account_id: vbRes.accountId, date: '2026-03-06', amount: 5000, payee: 'Max Muster', autoCategorize: false });
    const giro = saveAccount(b, { name: 'Girokonto', type: 'checking', bank: 'comdirect', owner: 'Max' });
    const depot = saveAccount(b, { name: 'Depot', type: 'depot', bank: 'comdirect', owner: 'Max' });
    saveAccount(b, { name: 'Depot', type: 'depot', bank: 'andere Bank', owner: 'Max' });

    const st = parseBankCsv(COMDIRECT);
    expect(suggestAccount(b, st)).toBe(giro);
    const extra = pendingSuggestedRules(b);
    const plan = planBankImport(b, st, giro, extra);
    expect(plan.transfers).toBe(2);
    expect(plan.depot).toBe(1);
    expect(plan.depotName).toBe('Depot · Max');
    const coupon = plan.rows.find((r) => r.amount === 2000)!;
    expect(listCategories(b).find((c) => c.id === coupon.categoryId)?.name).toBe('Zinsen & Dividenden');

    const res = commitBankImport(b, st, { accountId: giro, extraRules: extra });
    expect(res.imported).toBe(6);
    expect(res.transfers).toBe(3);
    expect(res.balance).toBe(127000);
    const tx = listTransactions(b, { kind: 'transfer' });
    expect(tx).toHaveLength(6); // drei Umbuchungen mit je zwei Hälften
    expect(listTransactions(b, { accountId: depot })[0].amount).toBe(50000);
    expect(listTransactions(b, { accountId: vbRes.accountId, kind: 'transfer' })).toHaveLength(2);
    // zweiter Import: nichts doppelt
    const again = planBankImport(b, parseBankCsv(COMDIRECT), giro);
    expect(again.newCount).toBe(0);
    expect(again.duplicates).toBe(6);
  });

  it('liest den Kreditkarten-Export und verknüpft Abrechnung und Einzahlung mit dem Referenzkonto', async () => {
    // frei erfundene Daten im Aufbau eines Kartenexports (Vorspann, dann Umsätze mit Uhrzeit und Unterkategorie)
    const card = [
      '"Muster Visa - Umsätze "', '',
      '"Karteninhaber: ";"Max Muster"', '"Referenzkonto:";"DE00123456780000000009"', '"Verbraucht:";"40,00 €"', '',
      '"Datum";"Zeit";"Karte";"Beschreibung";"Umsatzkategorie";"Unterkategorie";"Betrag";"Punkte"',
      '"20.03.2026 ";"10:00 Uhr";"****1111";"EDEKA MUSTER";"Lebensmittel";"Lebensmittel und Supermärkte";"-40,00 €";"0"',
      '"15.03.2026 ";"09:00 Uhr";"****1111";"EINZAHLUNG AUF KARTE **1111";"Einkommen";"Sonstiges (Einkommen)";"25,00 €";"0"',
      '"12.03.2026 ";"12:00 Uhr";"****1111";"Hotel am See";"Reisen";"Hotels und Unterkünfte";"-25,00 €";"0"',
      '"28.02.2026 ";"08:00 Uhr";"****1111";"Kartenabrechnung";"Einkommen";"Sonstiges (Einkommen)";"80,00 €";"0"',
      '"20.02.2026 ";"18:00 Uhr";"****1111";"EDEKA MUSTER";"Lebensmittel";"Lebensmittel und Supermärkte";"-80,00 €";"0"',
    ].join('\r\n');
    const st = parseBankCsv(card);
    expect(st.kind).toBe('credit');
    expect(st.accountName).toBe('Muster Visa');
    expect(st.refIban).toBe('DE00123456780000000009');
    expect(st.rows).toHaveLength(5);
    expect(st.endBalance).toBe(-4000);
    expect(st.startBalance).toBe(0);

    // Export für einen früheren Zeitraum: „Verbraucht“ gilt für den Exporttag, nicht für das Ende der Datei
    const old = card.replace('"Verbraucht:";"40,00 €"', '"Datum der Belastung: ";"22/11/2026 09:36h"\r\n"Zeitraum der Bewegung: ";"01.01.2026 - 31.03.2026"\r\n"Verbraucht:";"999,00 €"');
    const stOld = parseBankCsv(old);
    expect(stOld.endBalance).toBeNull();
    expect(stOld.startBalance).toBeNull();
    expect(stOld.warnings.join(' ')).toMatch(/Exporttag 22\.11\.2026/);
    // Zeitraum bis zum Exporttag: „Verbraucht“ ist der Endstand
    const cur = card.replace('"Verbraucht:";"40,00 €"', '"Datum der Belastung: ";"20/03/2026 18:00h"\r\n"Zeitraum der Bewegung: ";"01.01.2026 - 20.03.2026"\r\n"Verbraucht:";"40,00 €"');
    expect(parseBankCsv(cur).endBalance).toBe(-4000);

    const b = await newBook();
    const giro = saveAccount(b, { name: 'Girokonto', type: 'checking', owner: 'Max', iban: 'DE00123456780000000009' });
    saveTransaction(b, { account_id: giro, date: '2026-02-28', amount: -8000, payee: 'Abrechnung Muster Visa-Kreditkarte', autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-03-15', amount: -2500, payee: 'Max Muster', purpose: 'Umbuchung Kreditkarte', autoCategorize: false });
    saveTransaction(b, { account_id: giro, date: '2026-03-20', amount: -4000, payee: 'Barauszahlung', autoCategorize: false });
    expect(suggestAccount(b, st)).toBeNull();
    const plan = planBankImport(b, st, null);
    expect(plan.rows.filter((r) => r.transfer).map((r) => r.date)).toEqual(['2026-02-28', '2026-03-15']);
    const cats = new Map(listCategories(b).map((c) => [c.id, c.name]));
    expect(plan.rows.map((r) => (r.categoryId ? cats.get(r.categoryId) : null))).toEqual(['Supermarkt', null, 'Urlaub', null, 'Supermarkt']);

    const res = commitBankImport(b, st, { accountId: null });
    expect(res).toMatchObject({ imported: 5, transfers: 2, balance: -4000 });
    const acc = listAccounts(b).find((a) => a.id === res.accountId)!;
    expect([acc.type, acc.owner]).toEqual(['credit', 'Max']);
    expect(listTransactions(b, { accountId: giro }).filter((t) => t.transfer_id)).toHaveLength(2);
    expect(suggestAccount(b, st)).toBe(res.accountId);
    expect(commitBankImport(b, st, { accountId: res.accountId }).imported).toBe(0);
  });

  it('ordnet Zinsabschluss und Kapitalertragsteuer am Buchungstext zu, auch gegen eine Gebührenregel', async () => {
    const b = await newBook();
    const cat = (n: string) => listCategories(b).find((c) => c.name === n)!.id;
    const tg = saveAccount(b, { name: 'Tagesgeld', type: 'savings', bank: 'Musterbank' });
    const r = (date: string, text: string, purpose: string, amount: string, saldo: string) =>
      `Tagesgeld;DE00123456780000000002;BIC;Musterbank;${date};${date};;;;${text};${purpose};${amount};EUR;${saldo};;;;`;
    const csv = [HEAD,
      r('02.02.2026', 'Kapitalertragsteuer', 'Steuererstattung Kap.Steuer', '1,00', '1.010,00'),
      r('30.01.2026', 'Kapitalertragsteuer', 'Kapitalertragsteuer aus Habenzins', '-1,00', '1.009,00'),
      r('30.01.2026', 'Abschluss', 'Abschluss per 31.01.2026', '10,00', '1.010,00'),
    ].join('\r\n');
    const { saveRule } = await import('../src/db/repo');
    saveRule(b, { field: 'any', op: 'contains', value: 'abschluss', category_id: cat('Bankgebühren') } as never);
    const plan = planBankImport(b, parseBankCsv(csv), tg);
    expect(plan.rows.map((x) => x.categoryId)).toEqual([cat('Zinsen & Dividenden'), cat('Steuern'), cat('Steuern')]);
  });

  it('liest den ING-Export: Kopf mit Saldo ist keine Kreditkarte, Wertpapierkauf geht ins Depot, Vorabpauschale zu Steuern', async () => {
    // frei erfundene Daten im Aufbau des ING-Umsatzexports
    const ing = [
      'Umsatzanzeige;Datei erstellt am: 19.11.2026 15:41', '', 'IBAN;DE00 1234 5678 0000 0000 55', 'Kontoname;Extra-Konto', 'Bank;ING',
      'Kunde;Max Muster', 'Zeitraum;01.01.2026 - 19.11.2026', 'Saldo;0,00;EUR', '', 'Sortierung;Datum absteigend', '',
      'Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Referenz;Saldo;Währung;Betrag;Währung',
      '02.03.2026;04.03.2026;;Wertpapierkauf;WP-ABRECHNUNG 1 Kauf ISIN IE00TEST0001;;0,00;EUR;-90,00;EUR',
      '20.02.2026;20.02.2026;;Vorabpauschale;Zins/Dividende ISIN IE00TEST0001;;90,00;EUR;-10,00;EUR',
      '15.02.2026;15.02.2026;Max Muster;Gutschrift;Sparplan;;100,00;EUR;100,00;EUR',
    ].join('\r\n');
    const st = parseBankCsv(ing);
    expect([st.kind, st.bank, st.accountName, st.iban, st.endBalance, st.startBalance]).toEqual(['checking', 'ING', 'Extra-Konto', 'DE00123456780000000055', 0, 0]);
    const b = await newBook();
    const acc = saveAccount(b, { name: 'Extra-Konto', type: 'checking', bank: 'ING', owner: 'Max' });
    saveAccount(b, { name: 'Depot', type: 'depot', bank: 'ING', owner: 'Max' });
    const plan = planBankImport(b, st, acc);
    const steuer = listCategories(b).find((c) => c.name === 'Steuern')!.id;
    expect(plan.rows.map((r) => [r.date, r.categoryId === steuer, !!r.transfer])).toEqual([['2026-02-15', false, false], ['2026-02-20', true, false], ['2026-03-02', false, true]]);
    expect(plan.depot).toBe(1);
  });
});
