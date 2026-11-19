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
