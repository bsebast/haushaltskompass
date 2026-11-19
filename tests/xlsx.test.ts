import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'zlib';
import { newBook } from './helpers';
import { readXlsx, xlsxToCsv, isXlsx } from '../src/lib/xlsx';
import { parseBankCsv, planBankImport, commitBankImport } from '../src/db/bankcsv';
import { listAccounts, saveAccount, saveTransaction } from '../src/db/repo';

/** baut eine kleine ZIP-Datei (deflate) wie Excel sie schreibt */
function zip(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, 'utf8')); const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, n, data); central.push(cd, n); offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, end]));
}

// frei erfundene Daten im Aufbau eines Kreditkartenexports mit Kreditrahmen und Verfügungsrahmen
const strings = ['Kontoname', 'Muster Kreditkarte', 'IBAN', 'DE00123456780000000077', 'Kreditrahmen', '1.000,00', 'Verfügungsrahmen', '960,00',
  'Referenznummer', 'Buchungsdatum', 'Betrag', 'Beschreibung', 'Typ', 'Status', 'Karteninhaber', 'Details',
  'R2', '10.03.2026', '-50,00 €', 'Café &amp; Bar', 'Belastung', 'abgerechnet', 'MAX MUSTER', 'CAFE UND BAR STADT',
  '', '12.03.2026', '+10,00 €', 'Gutschrift Echtzeitüberweisung', 'Gutschrift', 'vorgemerkt'];
const s = (i: number) => `<x:c t="s"><x:v>${i}</x:v></x:c>`;
const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="m"><x:sheetData>
<x:row><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row>
<x:row>${s(2)}${s(3)}</x:row><x:row>${s(4)}${s(5)}</x:row><x:row>${s(6)}${s(7)}</x:row><x:row/>
<x:row>${[8, 9, 10, 11, 12, 13, 14, 15].map(s).join('')}</x:row>
<x:row>${[16, 17, 18, 19, 20, 21, 22, 23].map(s).join('')}</x:row>
<x:row><x:c r="B8" t="s"><x:v>25</x:v></x:c>${[26, 27, 28, 29].map(s).join('')}<x:c r="H8" t="s"><x:v>27</x:v></x:c></x:row>
</x:sheetData></x:worksheet>`;
const file = () => zip({
  'xl/workbook.xml': '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="T" sheetId="1" r:id="R1"/></x:sheets></x:workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="R1" Type="ws" Target="worksheets/sheet.xml"/></Relationships>',
  'xl/worksheets/sheet.xml': sheet,
  'xl/sharedStrings.xml': `<x:sst xmlns:x="m">${strings.map((t) => `<x:si><x:t>${t}</x:t></x:si>`).join('')}</x:sst>`,
});

describe('Excel (.xlsx)', () => {
  it('liest Zellen mit Spaltenbezug und gemeinsamen Texten', async () => {
    const f = file();
    expect(isXlsx(f)).toBe(true);
    const rows = await readXlsx(f);
    expect(rows[0]).toEqual(['Kontoname', 'Muster Kreditkarte']);
    expect(rows[7]).toEqual(['', '12.03.2026', '+10,00 €', 'Gutschrift Echtzeitüberweisung', 'Gutschrift', 'vorgemerkt', '', 'Gutschrift Echtzeitüberweisung']);
    expect(rows[6][3]).toBe('Café & Bar');
  });

  it('Kreditkartenexport: Saldo aus Kreditrahmen, Gutschrift als Ausgleich vom Girokonto', async () => {
    const st = parseBankCsv(await xlsxToCsv(file()));
    expect([st.kind, st.accountName, st.bank, st.iban, st.holder]).toEqual(['credit', 'Muster Kreditkarte', 'Muster', 'DE00123456780000000077', 'MAX MUSTER']);
    expect(st.endBalance).toBe(-4000);
    expect(st.rows.map((r) => r.amount)).toEqual([-5000, 1000]);
    expect(st.rows[0].hash).toContain('ref:R2');

    const b = await newBook();
    const giro = saveAccount(b, { name: 'Giro', type: 'checking', owner: 'Max' });
    saveTransaction(b, { account_id: giro, date: '2026-03-12', amount: -1000, payee: 'Max Muster', purpose: 'Karte ausgleichen', autoCategorize: false });
    expect(planBankImport(b, st, null).rows[1].transfer?.accountId).toBe(giro);
    const r = commitBankImport(b, st, { accountId: null });
    expect(r).toMatchObject({ imported: 2, transfers: 1, balance: -4000 });
    expect(listAccounts(b).find((a) => a.id === r.accountId)).toMatchObject({ type: 'credit', owner: 'Max' });
  });
});
