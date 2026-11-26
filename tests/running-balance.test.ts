import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { saveAccount, saveTransaction, saveSnapshot, runningBalances, listAccounts, listTransactions } from '../src/db/repo';

describe('laufender Kontostand', () => {
  it('ohne Snapshot: Anfangssaldo + Buchungen, neueste Zeile = Kontostand', async () => {
    const b = await newBook();
    const a = saveAccount(b, { name: 'Giro', type: 'checking', opening_balance: 10000 });
    saveTransaction(b, { account_id: a, date: '2026-01-02', amount: -2000 });
    saveTransaction(b, { account_id: a, date: '2026-01-02', amount: -500 });
    saveTransaction(b, { account_id: a, date: '2026-01-05', amount: 3000 });
    const r = runningBalances(b, a);
    const rows = listTransactions(b, { accountId: a });
    // zwei Buchungen am selben Tag: Reihenfolge wie in der Liste, Saldo je Zeile passt zur Zeile darunter
    expect(r.get(rows[0].id)).toBe(10500);
    expect(r.get(rows[2].id)).toBe(10000 + rows[2].amount);
    rows.slice(0, -1).forEach((t, i) => expect(r.get(t.id)! - t.amount).toBe(r.get(rows[i + 1].id)));
    expect(r.get(rows[0].id)).toBe(listAccounts(b).find((x) => x.id === a)!.balance);
  });

  it('mit Snapshots: vorher rückwärts, danach vorwärts, am Ende gleich dem Kontostand', async () => {
    const b = await newBook();
    const a = saveAccount(b, { name: 'Karte', type: 'credit' });
    saveTransaction(b, { account_id: a, date: '2026-03-01', amount: -1000 });
    saveTransaction(b, { account_id: a, date: '2026-03-10', amount: -2000 });
    saveSnapshot(b, a, '2026-03-10', -5000); // Bank: −50 € nach beiden Buchungen
    saveTransaction(b, { account_id: a, date: '2026-03-12', amount: -300 }); // danach (vorgemerkt)
    const r = runningBalances(b, a);
    const rows = listTransactions(b, { accountId: a });
    expect(rows.map((t) => r.get(t.id))).toEqual([-5300, -5000, -3000]);
    expect(r.get(rows[0].id)).toBe(listAccounts(b).find((x) => x.id === a)!.balance);
  });
});
