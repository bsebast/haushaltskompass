import type { Book } from './core';
import type { Account, AccountType, Budget, Category, CategoryNode, Holding, Pension, Rule, Snapshot, Split, Transaction } from './types';
import { findCategory } from './rules';
import { uid, now } from '../lib/id';

/* ---------- Konten ---------- */

/**
 * Kontostand = letzter erfasster Kontostand (Snapshot) + Buchungen danach;
 * ohne Snapshot: Anfangssaldo + alle Buchungen.
 * Automatisch ergänzte Gegenbuchungen am Tag des Snapshots zählen mit: Die Bank kannte sie beim Auszug noch nicht.
 */
export function listAccounts(b: Book, includeArchived = false): Account[] {
  return b.all<Account>(
    `with anchor as (
       select account_id, max(date) as date from balance_snapshots group by account_id
     )
     select a.*, an.date as balance_date,
       case when an.date is null
         then a.opening_balance + coalesce((select sum(amount) from transactions t where t.account_id = a.id), 0)
         else (select balance from balance_snapshots s where s.account_id = a.id and s.date = an.date)
              + coalesce((select sum(amount) from transactions t where t.account_id = a.id
                  and (t.date > an.date or (t.date = an.date and t.auto_counterpart = 1))), 0)
       end as balance
     from accounts a left join anchor an on an.account_id = a.id
     ${includeArchived ? '' : 'where a.archived = 0'}
     order by a.archived, coalesce(a.owner, '') collate nocase, a.sort_order, a.name collate nocase`,
  );
}

export interface AccountInput {
  id?: string;
  name: string;
  type: AccountType;
  owner?: string | null;
  opening_balance?: number;
  iban?: string | null;
  archived?: boolean;
  /** Externes Konto: nur Gegenkonto für Durchbuchungen, zählt nicht zum Vermögen */
  external?: boolean;
  bank?: string | null;
  interest_rate?: number | null;
  exemption?: number | null;
  exemption_used?: number | null;
  note?: string | null;
}

export function saveAccount(b: Book, a: AccountInput): string {
  const name = a.name.trim();
  if (!name) throw new Error('Bitte einen Kontonamen eingeben.');
  const t = now();
  if (a.id) {
    b.run(
      `update accounts set name=?, type=?, owner=?, opening_balance=?, iban=?, archived=?, external=?, bank=?, interest_rate=?, exemption=?, exemption_used=?, note=?, updated_at=? where id=?`,
      [name, a.type, a.owner ?? null, a.opening_balance ?? 0, a.iban ?? null, a.archived ? 1 : 0, a.external ? 1 : 0, a.bank ?? null, a.interest_rate ?? null,
        a.exemption ?? null, a.exemption_used ?? null, a.note ?? null, t, a.id],
    );
    return a.id;
  }
  const id = uid();
  const order = (b.value<number>('select coalesce(max(sort_order), -1) + 1 from accounts') ?? 0) as number;
  b.run(
    `insert into accounts (id, name, type, owner, opening_balance, iban, archived, external, bank, interest_rate, exemption, exemption_used, note, sort_order, created_at, updated_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, a.type, a.owner ?? null, a.opening_balance ?? 0, a.iban ?? null, a.archived ? 1 : 0, a.external ? 1 : 0, a.bank ?? null, a.interest_rate ?? null,
      a.exemption ?? null, a.exemption_used ?? null, a.note ?? null, order, t, t],
  );
  return id;
}

export function deleteAccount(b: Book, id: string) {
  b.tx(() => removeAccount(b, id));
}

function removeAccount(b: Book, id: string) {
  // Gegenbuchungen von Umbuchungen auf anderen Konten werden zu normalen Buchungen
  b.run(
    `update transactions set transfer_id = null
     where transfer_id in (select transfer_id from transactions where account_id = ? and transfer_id is not null)
       and account_id <> ?`,
    [id, id],
  );
  // Verträge bleiben erhalten, nur ohne Abbuchungskonto; Depotpositionen des Kontos gehen mit
  b.run('update recurring set account_id = null where account_id = ?', [id]);
  b.run('delete from holdings where account_id = ?', [id]);
  b.run('delete from accounts where id = ?', [id]);
}

/** Was beim Entfernen einer Person wegfällt (Konten, Buchungen, Kontostände, Depotpositionen, Vorsorge). */
export interface PersonSummary { accounts: number; transactions: number; snapshots: number; holdings: number; pensions: number }

export function personSummary(b: Book, owner: string): PersonSummary {
  const ids = `select id from accounts where owner = ?`;
  const n = (sql: string, p: string[]) => b.get<{ n: number }>(sql, p)?.n ?? 0;
  return {
    accounts: n('select count(*) n from accounts where owner = ?', [owner]),
    transactions: n(`select count(*) n from transactions where account_id in (${ids})`, [owner]),
    snapshots: n(`select count(*) n from balance_snapshots where account_id in (${ids})`, [owner]),
    holdings: n(`select count(*) n from holdings where owner = ? or account_id in (${ids})`, [owner, owner]),
    pensions: n('select count(*) n from pensions where person = ?', [owner]),
  };
}

/** Entfernt alle Konten einer Person samt Buchungen, Kontoständen, Depotpositionen und Vorsorge. Verträge bleiben. */
export function deletePerson(b: Book, owner: string): PersonSummary {
  return b.tx(() => {
    const sum = personSummary(b, owner);
    for (const { id } of b.all<{ id: string }>('select id from accounts where owner = ?', [owner])) removeAccount(b, id);
    b.run('delete from holdings where owner = ?', [owner]);
    b.run('delete from pensions where person = ?', [owner]);
    return sum;
  });
}

/* ---------- Kategorien ---------- */

export function listCategories(b: Book): Category[] {
  return b.all<Category>('select * from categories order by kind desc, sort_order, name collate nocase');
}

export function categoryTree(cats: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  cats.forEach((c) => byId.set(c.id, { ...c, children: [], path: c.name }));
  const roots: CategoryNode[] = [];
  byId.forEach((n) => {
    const p = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  });
  const setPath = (n: CategoryNode, prefix: string) => {
    n.path = prefix ? `${prefix} › ${n.name}` : n.name;
    n.children.forEach((c) => setPath(c, n.path));
  };
  roots.forEach((r) => setPath(r, ''));
  return roots;
}

export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Id der obersten Kategorie für jede Kategorie */
export function rootOf(cats: Category[]): Map<string, string> {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const res = new Map<string, string>();
  for (const c of cats) {
    let cur = c;
    const seen = new Set<string>();
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id)!;
    }
    res.set(c.id, cur.id);
  }
  return res;
}

export function descendantIds(cats: Category[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) cats.filter((c) => c.parent_id === out[i]).forEach((c) => out.push(c.id));
  return out;
}

export interface CategoryInput {
  id?: string;
  name: string;
  kind: 'income' | 'expense';
  parent_id?: string | null;
  color?: string | null;
  tax_category?: string | null;
}

export function saveCategory(b: Book, c: CategoryInput): string {
  const name = c.name.trim();
  if (!name) throw new Error('Bitte einen Namen eingeben.');
  const t = now();
  if (c.parent_id) {
    const parent = b.get<Category>('select * from categories where id = ?', [c.parent_id]);
    if (!parent) throw new Error('Oberkategorie nicht gefunden.');
    if (c.id && descendantIds(listCategories(b), c.id).includes(c.parent_id)) {
      throw new Error('Eine Kategorie kann nicht unter sich selbst liegen.');
    }
  }
  if (c.id) {
    b.run('update categories set name=?, kind=?, parent_id=?, color=?, tax_category=?, updated_at=? where id=?', [
      name, c.kind, c.parent_id ?? null, c.color ?? null, c.tax_category ?? null, t, c.id,
    ]);
    return c.id;
  }
  const id = uid();
  b.run(
    'insert into categories (id, parent_id, name, kind, color, tax_category, sort_order, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)',
    [id, c.parent_id ?? null, name, c.kind, c.color ?? null, c.tax_category ?? null, 999, t, t],
  );
  return id;
}

export function categoryUsage(b: Book, id: string): number {
  return (b.value<number>(
    `select (select count(*) from transactions where category_id = ?) + (select count(*) from splits where category_id = ?)`,
    [id, id],
  ) ?? 0) as number;
}

/** Löscht eine Kategorie; Unterkategorien wandern eine Ebene nach oben, Buchungen werden optional umgehängt. */
export function deleteCategory(b: Book, id: string, moveTo: string | null = null) {
  b.tx(() => {
    const c = b.get<Category>('select * from categories where id = ?', [id]);
    if (!c) return;
    b.run('update categories set parent_id = ? where parent_id = ?', [c.parent_id, id]);
    b.run('update transactions set category_id = ? where category_id = ?', [moveTo, id]);
    b.run('update splits set category_id = ? where category_id = ?', [moveTo, id]);
    b.run('delete from categories where id = ?', [id]);
  });
}

/* ---------- Buchungen ---------- */

export interface TxFilter {
  accountId?: string | null;
  from?: string;
  to?: string;
  categoryIds?: string[];
  uncategorized?: boolean;
  search?: string;
  kind?: 'income' | 'expense' | 'transfer';
  limit?: number;
  /** nur diese Buchungen (z. B. für die Detailansicht einer Auswertung) */
  ids?: string[];
  /** mehrere Konten (zusätzlich zu accountId) */
  accountIds?: string[];
  /** nur Buchungen, die diesem Vertrag zugeordnet sind */
  recurringId?: string;
}

export function listTransactions(b: Book, f: TxFilter = {}): Transaction[] {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.accountId) { where.push('t.account_id = ?'); p.push(f.accountId); }
  if (f.accountIds) { where.push(`t.account_id in (${f.accountIds.map(() => '?').join(',') || "''"})`); p.push(...f.accountIds); }
  if (f.ids) { where.push(`t.id in (${f.ids.map(() => '?').join(',') || "''"})`); p.push(...f.ids); }
  if (f.recurringId) { where.push('t.recurring_id = ?'); p.push(f.recurringId); }
  if (f.from) { where.push('t.date >= ?'); p.push(f.from); }
  if (f.to) { where.push('t.date <= ?'); p.push(f.to); }
  if (f.kind === 'income') where.push('t.amount > 0 and t.transfer_id is null');
  if (f.kind === 'expense') where.push('t.amount < 0 and t.transfer_id is null');
  if (f.kind === 'transfer') where.push('t.transfer_id is not null');
  if (f.uncategorized) {
    where.push('t.category_id is null and t.transfer_id is null and not exists (select 1 from splits s where s.transaction_id = t.id)');
  }
  if (f.categoryIds?.length) {
    const q = f.categoryIds.map(() => '?').join(',');
    where.push(`(t.category_id in (${q}) or exists (select 1 from splits s where s.transaction_id = t.id and s.category_id in (${q})))`);
    p.push(...f.categoryIds, ...f.categoryIds);
  }
  if (f.search?.trim()) {
    const terms = f.search.trim().toLowerCase().split(/\s+/);
    for (const term of terms) {
      const amountTerm = term.replace(/\./g, '').replace(',', '.');
      const isNum = /^-?\d+(\.\d{1,2})?$/.test(amountTerm);
      where.push(
        `(lower(coalesce(t.payee,'')) like ? or lower(coalesce(t.purpose,'')) like ? or lower(coalesce(t.note,'')) like ? or lower(coalesce(c.name,'')) like ?${
          isNum ? ' or abs(t.amount) = ?' : ''
        })`,
      );
      const like = `%${term}%`;
      p.push(like, like, like, like);
      if (isNum) p.push(Math.round(Math.abs(Number(amountTerm)) * 100));
    }
  }
  const sql = `
    select t.*, a.name as account_name, c.name as category_name, c.color as category_color,
      (select count(*) from splits s where s.transaction_id = t.id) as split_count,
      (select count(*) from document_links d where d.transaction_id = t.id) as doc_count
    from transactions t
    join accounts a on a.id = t.account_id
    left join categories c on c.id = t.category_id
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by t.date desc, t.created_at desc, t.id desc
    ${f.limit ? `limit ${Math.floor(f.limit)}` : ''}`;
  return b.all<Transaction>(sql, p);
}

/**
 * Laufender Kontostand nach jeder Buchung eines Kontos, wie im Kontoauszug.
 * Gleiche Rechnung wie listAccounts/balancesAt: Tagesendstand = letzter Kontostand (Snapshot) ≤ Tag + Buchungen danach,
 * am Snapshot-Tag zählen nur die automatisch ergänzten Gegenbuchungen dazu. Vor dem ersten Snapshot wird vom ersten
 * Snapshot rückwärts gerechnet, ohne Snapshot vom Anfangssaldo vorwärts. Innerhalb eines Tages gilt die Reihenfolge
 * der Liste (älteste zuerst), die neueste Buchung des Tages trägt den Tagesendstand.
 */
export function runningBalances(b: Book, accountId: string): Map<string, number> {
  const acc = b.get<{ opening_balance: number }>('select opening_balance from accounts where id = ?', [accountId]);
  const out = new Map<string, number>();
  if (!acc) return out;
  const tx = b.all<{ id: string; date: string; amount: number; auto: number }>(
    'select id, date, amount, auto_counterpart as auto from transactions where account_id = ? order by date, created_at, id', [accountId]);
  const snaps = b.all<{ date: string; balance: number }>('select date, balance from balance_snapshots where account_id = ? order by date', [accountId]);
  // Buchungssummen je Tag (alle und nur automatische Gegenbuchungen)
  const days: string[] = [];
  const daySum = new Map<string, number>();
  const dayAuto = new Map<string, number>();
  for (const t of tx) {
    if (!daySum.has(t.date)) { days.push(t.date); daySum.set(t.date, 0); dayAuto.set(t.date, 0); }
    daySum.set(t.date, daySum.get(t.date)! + t.amount);
    if (t.auto) dayAuto.set(t.date, dayAuto.get(t.date)! + t.amount);
  }
  const endOfDay = new Map<string, number>();
  if (!snaps.length) {
    let bal = acc.opening_balance;
    for (const d of days) { bal += daySum.get(d)!; endOfDay.set(d, bal); }
  } else {
    let si = -1;
    let bal = 0;
    for (const d of days) {
      let moved = false;
      while (si + 1 < snaps.length && snaps[si + 1].date <= d) { si++; moved = true; }
      if (si < 0) continue; // vor dem ersten Snapshot: unten rückwärts
      if (moved) {
        const s = snaps[si];
        bal = s.balance + (s.date === d ? dayAuto.get(d)! : daySum.get(d)!);
      } else bal += daySum.get(d)!;
      endOfDay.set(d, bal);
    }
    // vor dem ersten Snapshot rückwärts rechnen: Stand am Vortag = Stand am Tag − Buchungen des Tages
    const first = snaps[0];
    let back = first.balance - (daySum.get(first.date) ?? 0) + (dayAuto.get(first.date) ?? 0); // Stand vor allen Buchungen bis zum Snapshot-Tag
    // back ist jetzt der Stand am Ende des letzten Tages vor first.date
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (d >= first.date) continue;
      endOfDay.set(d, back);
      back -= daySum.get(d)!;
    }
  }
  // je Tag von der neuesten Buchung rückwärts
  for (let i = tx.length - 1; i >= 0; ) {
    const d = tx[i].date;
    let bal = endOfDay.get(d)!;
    for (; i >= 0 && tx[i].date === d; i--) { out.set(tx[i].id, bal); bal -= tx[i].amount; }
  }
  return out;
}

export function getSplits(b: Book, txId: string): Split[] {
  return b.all<Split>('select id, category_id, amount, note from splits where transaction_id = ? order by rowid', [txId]);
}

export interface TxInput {
  id?: string;
  account_id: string;
  date: string;
  amount: number;
  payee?: string | null;
  purpose?: string | null;
  note?: string | null;
  category_id?: string | null;
  splits?: Split[];
  is_lump_sum?: boolean;
  import_hash?: string | null;
  /** IBAN der Gegenseite laut Bank (nur beim Anlegen) */
  counter_iban?: string | null;
  /** Vertrag, zu dem die Buchung gehört (nur beim Anlegen) */
  recurring_id?: string | null;
  /** Regeln anwenden, wenn keine Kategorie gesetzt ist (Standard: ja) */
  autoCategorize?: boolean;
}

export function listRules(b: Book): Rule[] {
  return b.all<Rule>('select * from rules order by priority, rowid');
}

export function saveTransaction(b: Book, t: TxInput): string {
  if (!t.account_id) throw new Error('Bitte ein Konto wählen.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('Ungültiges Datum.');
  if (!Number.isInteger(t.amount) || t.amount === 0) throw new Error('Bitte einen Betrag eingeben.');
  const splits = (t.splits ?? []).filter((s) => s.amount !== 0);
  if (splits.length) {
    const sum = splits.reduce((a, s) => a + s.amount, 0);
    if (sum !== t.amount) throw new Error('Die Summe der Aufteilung muss dem Gesamtbetrag entsprechen.');
  }
  let category = splits.length ? null : t.category_id ?? null;
  if (!category && !splits.length && t.autoCategorize !== false) {
    category = findCategory(listRules(b), t);
  }
  const ts = now();
  return b.tx(() => {
    let id = t.id;
    if (id) {
      const prev = b.get<{ transfer_id: string | null }>('select transfer_id from transactions where id = ?', [id]);
      if (prev?.transfer_id) throw new Error('Umbuchungen bitte über den Umbuchungsdialog bearbeiten.');
      b.run(
        `update transactions set account_id=?, date=?, amount=?, payee=?, purpose=?, note=?, category_id=?, is_lump_sum=?, updated_at=? where id=?`,
        [t.account_id, t.date, t.amount, t.payee ?? null, t.purpose ?? null, t.note ?? null, category, t.is_lump_sum ? 1 : 0, ts, id],
      );
      b.run('delete from splits where transaction_id = ?', [id]);
    } else {
      id = uid();
      b.run(
        `insert into transactions (id, account_id, date, amount, payee, purpose, note, category_id, is_lump_sum, import_hash, recurring_id, counter_iban, created_at, updated_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, t.account_id, t.date, t.amount, t.payee ?? null, t.purpose ?? null, t.note ?? null, category, t.is_lump_sum ? 1 : 0, t.import_hash ?? null, t.recurring_id ?? null,
          t.counter_iban?.replace(/\s/g, '').toUpperCase() || null, ts, ts],
      );
    }
    for (const s of splits) {
      b.run('insert into splits (id, transaction_id, category_id, amount, note) values (?,?,?,?,?)', [uid(), id, s.category_id, s.amount, s.note ?? null]);
    }
    return id;
  });
}

export interface TransferInput {
  transfer_id?: string;
  from_account: string;
  to_account: string;
  date: string;
  amount: number; // positiv
  note?: string | null;
}

export function saveTransfer(b: Book, t: TransferInput): string {
  if (t.from_account === t.to_account) throw new Error('Quell- und Zielkonto müssen verschieden sein.');
  if (!Number.isInteger(t.amount) || t.amount <= 0) throw new Error('Bitte einen positiven Betrag eingeben.');
  const accts = new Map(listAccounts(b, true).map((a) => [a.id, a.name]));
  const ts = now();
  const label = (amount: number, other: string) => `Umbuchung ${amount < 0 ? 'an' : 'von'} ${accts.get(other) ?? ''}`.trim();
  return b.tx(() => {
    const tid = t.transfer_id ?? uid();
    const rows = t.transfer_id
      ? b.all<{ id: string; amount: number; import_hash: string | null }>('select id, amount, import_hash from transactions where transfer_id = ?', [tid])
      : [];
    const from = rows.find((r) => r.amount < 0);
    const to = rows.find((r) => r.amount > 0);
    if (rows.length === 2 && from && to) {
      // vorhandene Seiten anpassen, damit importierte Buchungen ihren Fingerabdruck behalten
      const upd = (r: { id: string; import_hash: string | null }, acc: string, amount: number, other: string) => b.run(
        `update transactions set account_id = ?, date = ?, amount = ?, note = ?, category_id = null, updated_at = ?,
           payee = case when import_hash is null then ? else payee end where id = ?`,
        [acc, t.date, amount, t.note ?? null, ts, label(amount, other), r.id]);
      upd(from, t.from_account, -t.amount, t.to_account);
      upd(to, t.to_account, t.amount, t.from_account);
      return tid;
    }
    b.run('delete from transactions where transfer_id = ?', [tid]);
    const ins = (acc: string, amount: number, other: string) =>
      b.run(
        `insert into transactions (id, account_id, date, amount, payee, note, transfer_id, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)`,
        [uid(), acc, t.date, amount, label(amount, other), t.note ?? null, tid, ts, ts],
      );
    ins(t.from_account, -t.amount, t.to_account);
    ins(t.to_account, t.amount, t.from_account);
    return tid;
  });
}

/** Hinweis an automatisch angelegten Gegenbuchungen */
export const AUTO_COUNTERPART_NOTE = 'Gegenbuchung automatisch ergänzt';

/**
 * Macht eine vorhandene Buchung zur Umbuchung mit einem anderen eigenen Konto: Gibt es dort eine passende
 * Gegenbuchung (gleicher Betrag mit anderem Vorzeichen, höchstens 4 Tage Abstand), wird sie verknüpft,
 * sonst wird sie angelegt und markiert, damit ein späterer Import des Gegenkontos sie ersetzt.
 */
export function linkCounterpart(b: Book, txId: string, otherAccountId: string, opts: { create?: boolean } = {}): { counterpartId: string; created: boolean } | null {
  return b.tx(() => {
    const tx = b.get<{ id: string; account_id: string; date: string; amount: number; payee: string | null; purpose: string | null; transfer_id: string | null }>(
      'select id, account_id, date, amount, payee, purpose, transfer_id from transactions where id = ?', [txId]);
    if (!tx) throw new Error('Buchung nicht gefunden.');
    if (tx.account_id === otherAccountId) throw new Error('Quell- und Zielkonto müssen verschieden sein.');
    if (tx.transfer_id) return null;
    const ts = now();
    const m = b.get<{ id: string }>(
      `select id from transactions where account_id = ? and transfer_id is null and amount = ?
         and abs(julianday(date) - julianday(?)) <= 4 order by abs(julianday(date) - julianday(?)), date limit 1`,
      [otherAccountId, -tx.amount, tx.date, tx.date]);
    const tid = uid();
    let counterpartId: string;
    let created = false;
    if (m) {
      counterpartId = m.id;
      b.run('update transactions set transfer_id = ?, category_id = null, recurring_id = null, updated_at = ? where id = ?', [tid, ts, m.id]);
      b.run('delete from splits where transaction_id = ?', [m.id]);
    } else {
      if (opts.create === false) return null;
      counterpartId = uid();
      created = true;
      b.run(
        `insert into transactions (id, account_id, date, amount, payee, purpose, note, transfer_id, auto_counterpart, created_at, updated_at)
         values (?,?,?,?,?,?,?,?,1,?,?)`,
        [counterpartId, otherAccountId, tx.date, -tx.amount, tx.payee, tx.purpose, AUTO_COUNTERPART_NOTE, tid, ts, ts]);
    }
    b.run('update transactions set transfer_id = ?, category_id = null, recurring_id = null, updated_at = ? where id = ?', [tid, ts, tx.id]);
    b.run('delete from splits where transaction_id = ?', [tx.id]);
    return { counterpartId, created };
  });
}

export interface MissingCounterpart {
  txId: string; accountId: string; accountName: string; date: string; amount: number; payee: string | null;
  targetId: string; targetName: string; action: 'link' | 'create' | 'skip'; reason: string | null;
}

/** Zeitraum, für den ein Konto Buchungen aus einem Bankimport hat */
function importRange(b: Book, accountId: string): { from: string; to: string } | null {
  const r = b.get<{ f: string | null; t: string | null }>("select min(date) f, max(date) t from transactions where account_id = ? and import_hash like 'bank:%'", [accountId]);
  return r?.f && r.t ? { from: r.f, to: r.t } : null;
}

/**
 * Sucht Buchungen, deren Gegenseite laut Bank ein eigenes Konto ist (IBAN), die aber noch nicht als Umbuchung verknüpft sind.
 * Ist das Gegenkonto für den Tag schon per Bankimport erfasst, fehlt dort aber die Buchung, wird nichts angelegt
 * (sonst stimmte der Kontostand nicht mehr mit der Bank überein).
 */
export function findMissingCounterparts(b: Book): MissingCounterpart[] {
  const accts = listAccounts(b, true);
  const byIban = new Map(accts.filter((a) => a.iban).map((a) => [a.iban!.replace(/\s/g, '').toUpperCase(), a]));
  const name = (id: string) => { const a = accts.find((x) => x.id === id); return a ? `${a.bank ? `${a.bank} · ` : ''}${a.name}` : ''; };
  const rows = b.all<{ id: string; account_id: string; date: string; amount: number; payee: string | null; counter_iban: string }>(
    'select id, account_id, date, amount, payee, counter_iban from transactions where transfer_id is null and counter_iban is not null order by date');
  const out: MissingCounterpart[] = [];
  const ranges = new Map<string, { from: string; to: string } | null>();
  const claimed = new Set<string>();
  for (const r of rows) {
    const target = byIban.get(r.counter_iban);
    if (!target || target.id === r.account_id) continue;
    const base = { txId: r.id, accountId: r.account_id, accountName: name(r.account_id), date: r.date, amount: r.amount, payee: r.payee, targetId: target.id, targetName: name(target.id) };
    const m = b.all<{ id: string }>(
      `select id from transactions where account_id = ? and transfer_id is null and amount = ? and abs(julianday(date) - julianday(?)) <= 4
       order by abs(julianday(date) - julianday(?))`, [target.id, -r.amount, r.date, r.date]).find((x) => !claimed.has(x.id));
    if (m) { claimed.add(m.id); out.push({ ...base, action: 'link', reason: null }); continue; }
    if (!ranges.has(target.id)) ranges.set(target.id, importRange(b, target.id));
    const range = ranges.get(target.id);
    if (range && r.date >= range.from && r.date <= range.to) {
      out.push({ ...base, action: 'skip', reason: 'Im Gegenkonto ist dieser Zeitraum schon per Bankimport erfasst, die Buchung fehlt dort aber.' });
    } else out.push({ ...base, action: 'create', reason: null });
  }
  return out;
}

/** Verknüpft bzw. legt die gefundenen Gegenbuchungen an. Gibt die Anzahl verknüpfter und neu angelegter zurück. */
export function applyMissingCounterparts(b: Book, items: MissingCounterpart[]): { linked: number; created: number } {
  return b.tx(() => {
    let linked = 0; let created = 0;
    for (const it of items) {
      if (it.action === 'skip') continue;
      const r = linkCounterpart(b, it.txId, it.targetId, { create: it.action === 'create' });
      if (r?.created) created++; else if (r) linked++;
    }
    return { linked, created };
  });
}

export function getTransfer(b: Book, transferId: string): TransferInput | null {
  const rows = b.all<{ account_id: string; amount: number; date: string; note: string | null }>(
    'select account_id, amount, date, note from transactions where transfer_id = ?',
    [transferId],
  );
  const from = rows.find((r) => r.amount < 0);
  const to = rows.find((r) => r.amount > 0);
  if (!from || !to) return null;
  return { transfer_id: transferId, from_account: from.account_id, to_account: to.account_id, date: from.date, amount: to.amount, note: from.note };
}

export function deleteTransaction(b: Book, id: string) {
  b.tx(() => {
    const tx = b.get<{ transfer_id: string | null }>('select transfer_id from transactions where id = ?', [id]);
    if (tx?.transfer_id) b.run('delete from transactions where transfer_id = ?', [tx.transfer_id]);
    else b.run('delete from transactions where id = ?', [id]);
    // angehängte Belege, die sonst nirgends hängen, mit löschen
    b.run(`delete from documents where id not in (select document_id from document_links)
           and id not in (select document_id from inventory where document_id is not null)`);
  });
}

export function setCategory(b: Book, ids: string[], categoryId: string | null) {
  b.tx(() => {
    for (const id of ids) {
      b.run('update transactions set category_id = ?, updated_at = ? where id = ? and transfer_id is null', [categoryId, now(), id]);
      b.run('delete from splits where transaction_id = ?', [id]);
    }
  });
}

/** Häufig benutzte Empfänger für die Autovervollständigung, mit zuletzt genutzter Kategorie. */
export function payeeSuggestions(b: Book): { payee: string; category_id: string | null; n: number }[] {
  return b.all(
    `select payee, (select category_id from transactions t2 where t2.payee = t.payee and t2.category_id is not null order by date desc limit 1) as category_id, count(*) as n
     from transactions t where payee is not null and payee <> '' and transfer_id is null
     group by payee order by n desc limit 300`,
  );
}

/* ---------- Regeln ---------- */

export function saveRule(b: Book, r: Omit<Rule, 'id' | 'priority' | 'enabled'> & { id?: string; priority?: number; enabled?: number }): string {
  if (!r.value.trim()) throw new Error('Bitte einen Suchbegriff eingeben.');
  if (r.op === 'regex') {
    try { new RegExp(r.value); } catch { throw new Error('Ungültiger regulärer Ausdruck.'); }
  }
  const t = now();
  if (r.id) {
    b.run('update rules set field=?, op=?, value=?, category_id=?, priority=?, enabled=?, updated_at=? where id=?', [
      r.field, r.op, r.value.trim(), r.category_id, r.priority ?? 100, r.enabled ?? 1, t, r.id,
    ]);
    return r.id;
  }
  const id = uid();
  b.run('insert into rules (id, field, op, value, category_id, priority, enabled, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)', [
    id, r.field, r.op, r.value.trim(), r.category_id, r.priority ?? 100, r.enabled ?? 1, t, t,
  ]);
  return id;
}

export function deleteRule(b: Book, id: string) {
  b.run('delete from rules where id = ?', [id]);
}

/** Wendet die Regeln auf alle Buchungen ohne Kategorie an. Gibt die Anzahl geänderter Buchungen zurück. */
export function applyRulesToUncategorized(b: Book): number {
  const rules = listRules(b);
  const open = listTransactions(b, { uncategorized: true });
  let n = 0;
  b.tx(() => {
    for (const t of open) {
      const c = findCategory(rules, t);
      if (c) {
        b.run('update transactions set category_id = ?, updated_at = ? where id = ?', [c, now(), t.id]);
        n++;
      }
    }
  });
  return n;
}

/* ---------- Budgets ---------- */

export function listBudgets(b: Book): Budget[] {
  return b.all<Budget>('select * from budgets order by valid_from');
}

export function saveBudget(b: Book, x: Omit<Budget, 'id' | 'valid_to'> & { id?: string; valid_to?: string | null }): string {
  if (!Number.isInteger(x.amount) || x.amount <= 0) throw new Error('Bitte einen positiven Betrag eingeben.');
  const t = now();
  if (x.id) {
    b.run('update budgets set category_id=?, period=?, amount=?, valid_from=?, valid_to=?, updated_at=? where id=?', [
      x.category_id, x.period, x.amount, x.valid_from, x.valid_to ?? null, t, x.id,
    ]);
    return x.id;
  }
  const exists = b.get<{ id: string }>('select id from budgets where category_id = ? and valid_to is null', [x.category_id]);
  if (exists) throw new Error('Für diese Kategorie gibt es schon ein Budget.');
  const id = uid();
  b.run('insert into budgets (id, category_id, period, amount, valid_from, valid_to, created_at, updated_at) values (?,?,?,?,?,?,?,?)', [
    id, x.category_id, x.period, x.amount, x.valid_from, x.valid_to ?? null, t, t,
  ]);
  return id;
}

export function deleteBudget(b: Book, id: string) {
  b.run('delete from budgets where id = ?', [id]);
}

/* ---------- Kontostände (Snapshots) ---------- */

export function listSnapshots(b: Book, accountId?: string): Snapshot[] {
  return accountId
    ? b.all<Snapshot>('select * from balance_snapshots where account_id = ? order by date', [accountId])
    : b.all<Snapshot>('select * from balance_snapshots order by date');
}

/** Erfasst einen Kontostand an einem Tag (ersetzt einen vorhandenen am selben Tag). */
export function saveSnapshot(b: Book, accountId: string, date: string, balance: number, note: string | null = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ungültiges Datum.');
  if (!Number.isInteger(balance)) throw new Error('Ungültiger Betrag.');
  b.run(
    `insert into balance_snapshots (id, account_id, date, balance, note) values (?,?,?,?,?)
     on conflict(account_id, date) do update set balance = excluded.balance, note = excluded.note`,
    [uid(), accountId, date, balance, note],
  );
}

export function deleteSnapshot(b: Book, id: string) {
  b.run('delete from balance_snapshots where id = ?', [id]);
}

/* ---------- Depotpositionen ---------- */

export function listHoldings(b: Book): Holding[] {
  return b.all<Holding>('select * from holdings order by coalesce(owner, \'\') collate nocase, market_value desc');
}

export function saveHolding(b: Book, h: Omit<Holding, 'id'> & { id?: string }): string {
  if (!h.name.trim()) throw new Error('Bitte einen Namen eingeben.');
  const t = now();
  const vals = [h.account_id, h.owner, h.wkn, h.isin, h.name.trim(), h.quantity, h.cost_value, h.price, h.market_value, h.as_of, t];
  if (h.id) {
    b.run('update holdings set account_id=?, owner=?, wkn=?, isin=?, name=?, quantity=?, cost_value=?, price=?, market_value=?, as_of=?, updated_at=? where id=?', [...vals, h.id]);
    return h.id;
  }
  const id = uid();
  b.run('insert into holdings (account_id, owner, wkn, isin, name, quantity, cost_value, price, market_value, as_of, updated_at, id, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)', [...vals, id, t]);
  return id;
}

export function deleteHolding(b: Book, id: string) {
  b.run('delete from holdings where id = ?', [id]);
}

/* ---------- Vorsorge ---------- */

export function listPensions(b: Book): Pension[] {
  return b.all<Pension>('select * from pensions order by coalesce(person, \'\') collate nocase, provider collate nocase');
}

export function savePension(b: Book, p: Omit<Pension, 'id'> & { id?: string }): string {
  if (!p.provider.trim()) throw new Error('Bitte den Anbieter eingeben.');
  const t = now();
  const vals = [p.person, p.provider.trim(), p.contribution, p.interval, p.lump_sum, p.monthly_pension, p.projection1, p.projection2, p.projection3,
    p.start_text, p.as_of, p.advisor, p.death_action, p.note, t];
  if (p.id) {
    b.run(`update pensions set person=?, provider=?, contribution=?, interval=?, lump_sum=?, monthly_pension=?, projection1=?, projection2=?, projection3=?,
      start_text=?, as_of=?, advisor=?, death_action=?, note=?, updated_at=? where id=?`, [...vals, p.id]);
    return p.id;
  }
  const id = uid();
  b.run(`insert into pensions (person, provider, contribution, interval, lump_sum, monthly_pension, projection1, projection2, projection3,
    start_text, as_of, advisor, death_action, note, updated_at, id, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, id, t]);
  return id;
}

export function deletePension(b: Book, id: string) {
  b.run('delete from pensions where id = ?', [id]);
}
