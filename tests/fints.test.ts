import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newBook } from './helpers';
import { parseBankCsv, planBankImport, commitBankImport } from '../src/db/bankcsv';
import { fintsToStatement, blzFromIban, guessFintsBank, defaultFetchFrom, type FintsAccountData } from '../src/db/fints';
import { listTransactions, saveAccount } from '../src/db/repo';
import { FintsService, toStatementData } from '../vite-plugin-fints';

// frei erfundene Musterdaten
const IBAN = 'DE00123456780000000001';
const data = (over: Partial<FintsAccountData> = {}): FintsAccountData => ({
  iban: IBAN, accountNumber: '1', accountName: 'Girokonto', bank: 'Musterbank eG', holder: 'Max Muster',
  openingBalance: 50000, closingBalance: 50000 - 2865 + 100000,
  transactions: [
    { date: '2026-03-02', valueDate: '2026-03-02', amount: 100000, name: 'Arbeitgeber GmbH', counterAccount: 'DE11111111111111111111', purpose: 'EREF+123 SVWZ+Gehalt Maerz', bookingText: 'LOHN-/GEHALT-/RENTEN' },
    { date: '2026-03-01', valueDate: '2026-03-01', amount: -2865, name: 'DANKE EDEKA MUSTERMANN', counterAccount: null, purpose: 'EDEKA MUSTERMANN/ORT', bookingText: 'Kartenzahlung girocard' },
  ],
  ...over,
});

describe('FinTS-Abruf', () => {
  it('wandelt abgerufene Umsätze in einen Kontoauszug', () => {
    const st = fintsToStatement(data());
    expect(st.source).toBe('fints');
    expect(st.rows.map((r) => r.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(st.rows[1].purpose).toBe('Gehalt Maerz');
    expect(st.rows[1].counterIban).toBe('DE11111111111111111111');
    expect(st.startBalance).toBe(50000);
    expect(st.endBalance).toBe(147135);
    expect(st.rows[1].balance).toBe(147135);
    expect(st.warnings).toEqual([]);
    expect(st.rows[0].hash.startsWith('bank:fints:')).toBe(true);
  });

  it('erkennt Banken an BLZ und Namen', () => {
    expect(blzFromIban('DE89 3806 0186 0000 0000 00')).toBe('38060186');
    expect(guessFintsBank('38060186', 'Volksbank Köln Bonn')?.key).toBe('vr');
    expect(guessFintsBank('20041111', null)?.key).toBe('comdirect');
    expect(guessFintsBank('50010517', 'ING')?.key).toBe('ing');
    expect(guessFintsBank('10050000', 'Berliner Sparkasse')).toBeNull();
  });

  it('übernimmt einen zweiten, überlappenden Abruf nicht doppelt', async () => {
    const b = await newBook();
    const acc = saveAccount(b, { name: 'Giro', type: 'checking', iban: IBAN });
    commitBankImport(b, fintsToStatement(data()), { accountId: acc });
    const later = data({
      openingBalance: 50000, closingBalance: 147135 - 999,
      transactions: [...data().transactions, { date: '2026-03-04', valueDate: null, amount: -999, name: 'Kiosk', counterAccount: null, purpose: 'Zeitung', bookingText: 'Kartenzahlung' }],
    });
    const plan = planBankImport(b, fintsToStatement(later), acc);
    expect(plan.duplicates).toBe(2);
    expect(plan.newCount).toBe(1);
    expect(defaultFetchFrom(b, acc)).toBe('2026-02-20');
  });

  it('erkennt Buchungen, die schon per Datei importiert wurden', async () => {
    const b = await newBook();
    const acc = saveAccount(b, { name: 'Giro', type: 'checking', iban: IBAN });
    const HEAD = 'IBAN Auftragskonto;Buchungstag;Name Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Saldo nach Buchung';
    const csv = [HEAD, `${IBAN};02.03.2026;Arbeitgeber GmbH;Gutschrift;Gehalt;1.000,00;1.471,35`, `${IBAN};01.03.2026;EDEKA;Karte;EDEKA ORT;-28,65;471,35`].join('\n');
    commitBankImport(b, parseBankCsv(csv), { accountId: acc });
    const plan = planBankImport(b, fintsToStatement(data()), acc);
    expect(plan.duplicates).toBe(2);
    expect(plan.newCount).toBe(0);
    // und umgekehrt: eine Datei nach dem Abruf
    const b2 = await newBook();
    const acc2 = saveAccount(b2, { name: 'Giro', type: 'checking', iban: IBAN });
    commitBankImport(b2, fintsToStatement(data()), { accountId: acc2 });
    expect(planBankImport(b2, parseBankCsv(csv), acc2).newCount).toBe(0);
    expect(listTransactions(b2, { accountId: acc2 })).toHaveLength(2);
  });
});

/** Ersatz für die Bank: verlangt beim Abgleich eine App-Freigabe und liefert dann ein Konto. */
function fakeClient() {
  const account = { accountNumber: '1', subAccountId: '', iban: IBAN, product: 'Girokonto', holder1: 'Max Muster', accountType: 'CheckingAccount', customerId: 'x', currency: 'EUR' };
  const config = {
    tanMethodId: undefined as number | undefined, tanMediaName: undefined,
    bankingInformation: { systemId: '0', bankMessages: [], bpd: { bankName: 'Musterbank' } } as Record<string, unknown>,
    get selectedTanMethod() { return this.tanMethodId ? { id: 942, name: 'App', isDecoupled: true, decoupled: { waitingSecondsBetweenStatusRequests: 2 } } : undefined; },
    availableTanMethods: [{ id: 942, name: 'App', isDecoupled: true, activeTanMedia: [], tanMediaRequirement: 0 }],
  };
  let approvals = 0;
  const ok = { success: true, requiresTan: false, bankAnswers: [], bankingInformationUpdated: false, dialogId: '1' };
  return {
    config,
    selectTanMethod(id: number) { config.tanMethodId = id; },
    async synchronize() {
      if (!config.tanMethodId) return ok;
      return { ...ok, requiresTan: true, tanReference: 'r1', tanChallenge: 'Bitte in der App freigeben' };
    },
    async synchronizeWithTan() {
      if (++approvals < 2) return { ...ok, requiresTan: true, tanReference: 'r1' };
      config.bankingInformation.upd = { bankAccounts: [account] };
      return ok;
    },
    canGetAccountStatements: () => true,
    async getAccountStatements() {
      return { ...ok, statements: [{ openingBalance: { value: 10, date: new Date(), currency: 'EUR' }, closingBalance: { value: 9.5, date: new Date(), currency: 'EUR' },
        transactions: [{ entryDate: new Date(2026, 2, 5), valueDate: new Date(2026, 2, 5), amount: -0.5, remoteName: 'Bäcker', purpose: 'Brötchen', bookingText: 'Karte' }] }] };
    },
  };
}

describe('lokaler FinTS-Dienst', () => {
  it('führt durch TAN-Freigabe und Abruf und speichert keine PIN', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-fints-'));
    const svc = new FintsService(dir);
    await expect(svc.connect({ blz: '12345678', url: 'https://bank.example', userId: 'max', pin: 'geheim' })).rejects.toThrow(/Produktnummer/);
    svc.setProductId('TESTPRODUKT123');
    const c = await svc.connect({ blz: '12345678', url: 'https://bank.example', userId: 'max', pin: 'geheim', remember: true }, () => fakeClient() as never);
    expect(c.step).toBe('tan');
    expect(c.step === 'tan' && c.decoupled).toBe(true);
    expect((await svc.tan({ session: c.session })).step).toBe('tan'); // noch nicht freigegeben
    const acc = await svc.tan({ session: c.session });
    expect(acc.step).toBe('accounts');
    const key = acc.step === 'accounts' ? acc.accounts[0].key : '';
    const st = await svc.statements({ session: c.session, key, from: '2026-03-01' });
    expect(st.step).toBe('statement');
    if (st.step === 'statement') {
      expect(st.data.transactions[0]).toMatchObject({ date: '2026-03-05', amount: -50, name: 'Bäcker' });
      expect(st.data.openingBalance).toBe(1000);
      expect(fintsToStatement(st.data).endBalance).toBe(950);
    }
    expect(svc.logins()).toEqual({ '12345678': 'max' });
    const files = [join(dir, 'fints.json'), join(dir, 'logins.json'), ...readdirSync(join(dir, 'banken')).map((n) => join(dir, 'banken', n))];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain('geheim');
    svc.close(c.session);
    await expect(svc.tan({ session: c.session })).rejects.toThrow(/abgelaufen/);
  });

  it('rechnet Beträge der Bank exakt in Cent um', () => {
    const d = toStatementData({ accountNumber: '1', iban: IBAN } as never, null, [{
      openingBalance: { value: 0.1 + 0.2, date: new Date(), currency: 'EUR' }, closingBalance: { value: 1.15, date: new Date(), currency: 'EUR' },
      transactions: [{ entryDate: new Date(2026, 0, 1), valueDate: new Date(2026, 0, 1), amount: 0.85 } as never],
    }]);
    expect(d.openingBalance).toBe(30);
    expect(d.transactions[0].amount).toBe(85);
  });
});
