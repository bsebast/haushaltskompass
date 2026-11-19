import { it } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { openBook } from '../src/db/core';
import { parseBankCsv } from '../src/db/bankcsv';
import { listAccounts } from '../src/db/repo';
const P = '/mnt/project-files/haushaltsbuch/privat/';
it('cp', async () => {
  const b = openBook(await initSqlJs(), new Uint8Array(readFileSync(P + 'haushaltskompass-2026-11-19_v3.hkb')));
  const ibans = new Map<string, string>();
  for (const f of ['Umsaetze_Volksbank_2026.11.19.csv', 'umsaetze_comdirect_20261119.csv', 'Umsaetze_RenaultBank_2026.11.19.csv']) {
    const buf = readFileSync(P + f); let t = new TextDecoder().decode(buf); if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    for (const r of parseBankCsv(t).rows) if (r.counterIban) ibans.set(r.hash, r.counterIban);
  }
  const accts = listAccounts(b, true);
  const own = new Map(accts.filter((a) => a.iban).map((a) => [a.iban!, `${a.bank} ${a.name}`]));
  const tx = b.all<any>('select t.*, a.bank, a.name from transactions t join accounts a on a.id=t.account_id where t.transfer_id is null and t.import_hash is not null');
  const by = new Map<string, any[]>();
  for (const t of tx) { const i = ibans.get(t.import_hash); if (!i) continue; (by.get(i) ?? by.set(i, []).get(i)!).push(t); }
  for (const [i, arr] of [...by].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(i, own.get(i) ?? '', arr.length, arr.slice(0, 3).map((t) => `${t.bank}:${t.date}:${t.amount}:${t.payee}`).join(' ; '));
  console.log('own', [...own]);
});
