import { it, expect } from 'vitest';
import { newBook } from './helpers';
import { runImport, type ImportFile } from '../src/db/importer';
import { listAccounts, listHoldings, listPensions, listTransactions } from '../src/db/repo';
import { listContracts } from '../src/db/contracts';
import { balanceTrend } from '../src/db/reports';

const data: ImportFile = {
  format: 'haushaltskompass-import', version: 1,
  accounts: [
    { key: 'a', name: 'Tagesgeld', type: 'savings', owner: 'Anna', bank: 'Bank A', exemption: 250, exemption_used: 12.5,
      snapshots: [{ date: '2026-01-01', balance: 1000 }, { date: '2026-03-01', balance: 1200.5 }] },
    { key: 'b', name: 'Konto', type: 'checking', owner: 'Anna', bank: 'Bank B',
      transactions: [{ date: '2026-01-10', amount: 500, payee: 'Erbe', category: 'Sonstige Einnahmen' }, { date: '2026-02-01', amount: 3.2, payee: 'Zinsen', category: 'Zinsen & Dividenden' }] },
    { key: 'c', name: 'Neu', type: 'checking', owner: 'Anna', bank: 'Bank C' },
  ],
  transfers: [{ from: 'b', to: 'c', date: '2026-02-15', amount: 100 }],
  holdings: [{ account: 'a', owner: 'Anna', isin: 'DE000', name: 'Fonds', quantity: 1.5, cost_value: 100, market_value: 150.25 }],
  contracts: [
    { name: 'Versicherung X', person: 'Anna', amount: -10, interval: 'monatlich', due: '01.', doc_ref: '2.1.', death_action: 'kündigen', category: 'Versicherungen › Haftpflicht' },
    { name: 'Abo Y', person: 'Anna', amount: -35, interval: 'jährlich', status: 'ended', notice_period: '1 Monat' },
    { name: 'Null', amount: 0, interval: 'jährlich' },
  ],
  pensions: [{ person: 'Anna', provider: 'gesetzliche Rente', monthly_pension: 1631.76, projections: [1990, 2420], start: '2047-05-01' }],
};

it('Gesamtimport legt alles an und ist wiederholbar', async () => {
  const b = await newBook();
  const dry = runImport(b, data, { dryRun: true });
  expect(dry.accountsNew).toBe(3);
  expect(listAccounts(b)).toHaveLength(0);
  const s = runImport(b, data);
  expect(s).toMatchObject({ accountsNew: 3, snapshots: 2, transactions: 2, transfers: 1, holdings: 1, contractsNew: 2, contractsSkipped: 1, pensions: 1 });
  const accts = listAccounts(b);
  expect(accts.find((a) => a.name === 'Tagesgeld')?.balance).toBe(120050);
  expect(accts.find((a) => a.name === 'Konto')?.balance).toBe(50320 - 10000);
  expect(accts.find((a) => a.name === 'Tagesgeld')?.exemption_used).toBe(1250);
  expect(listContracts(b)).toHaveLength(1);
  expect(listContracts(b, true).find((c) => c.name === 'Versicherung X')?.death_action).toBe('kündigen');
  expect(listPensions(b)[0].projection2).toBe(242000);
  expect(listHoldings(b)[0].market_value).toBe(15025);
  // Saldenverlauf berücksichtigt Snapshots
  const trend = balanceTrend(b, '2026-01', '2026-03');
  expect(trend.map((t) => t.balance)).toEqual([100000 + 50000, 100000 + 50320, 120050 + 50320]);
  // zweiter Lauf erzeugt keine Dubletten
  const again = runImport(b, data);
  expect(again).toMatchObject({ accountsNew: 0, accountsExisting: 3, transactions: 0, transfers: 0, contractsNew: 0, contractsMerged: 2 });
  expect(listTransactions(b)).toHaveLength(4);
});
