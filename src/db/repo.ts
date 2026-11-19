import type { Book } from './core';
import type { Account, AccountType, Budget, Category, CategoryNode, Rule, Split, Transaction } from './types';
import { findCategory } from './rules';
import { uid, now } from '../lib/id';

/* ---------- Konten ---------- */

export function listAccounts(b: Book, includeArchived = false): Account[] {
  return b.all<Account>(
    `select a.*, a.opening_balance + coalesce((select sum(amount) from transactions t where t.account_id = a.id), 0) as balance
     from accounts a ${includeArchived ? '' : 'where a.archived = 0'}
     order by a.archived, a.sort_order, a.name collate nocase`,
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
}

export function saveAccount(b: Book, a: AccountInput): string {
  const name = a.name.trim();
  if (!name) throw new Error('Bitte einen Kontonamen eingeben.');
  const t = now();
  if (a.id) {
    b.run(
      'update accounts set name=?, type=?, owner=?, opening_balance=?, iban=?, archived=?, updated_at=? where id=?',
      [name, a.type, a.owner ?? null, a.opening_balance ?? 0, a.iban ?? null, a.archived ? 1 : 0, t, a.id],
    );
    return a.id;
  }
  const id = uid();
  const order = (b.value<number>('select coalesce(max(sort_order), -1) + 1 from accounts') ?? 0) as number;
  b.run(
    'insert into accounts (id, name, type, owner, opening_balance, iban, sort_order, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)',
    [id, name, a.type, a.owner ?? null, a.opening_balance ?? 0, a.iban ?? null, order, t, t],
  );
  return id;
}

export function deleteAccount(b: Book, id: string) {
  b.tx(() => {
    // Gegenbuchungen von Umbuchungen auf anderen Konten werden zu normalen Buchungen
    b.run(
      `update transactions set transfer_id = null
       where transfer_id in (select transfer_id from transactions where account_id = ? and transfer_id is not null)
         and account_id <> ?`,
      [id, id],
    );
    b.run('delete from accounts where id = ?', [id]);
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
}

export function listTransactions(b: Book, f: TxFilter = {}): Transaction[] {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.accountId) { where.push('t.account_id = ?'); p.push(f.accountId); }
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
    order by t.date desc, t.created_at desc
    ${f.limit ? `limit ${Math.floor(f.limit)}` : ''}`;
  return b.all<Transaction>(sql, p);
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
        `insert into transactions (id, account_id, date, amount, payee, purpose, note, category_id, is_lump_sum, import_hash, created_at, updated_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, t.account_id, t.date, t.amount, t.payee ?? null, t.purpose ?? null, t.note ?? null, category, t.is_lump_sum ? 1 : 0, t.import_hash ?? null, ts, ts],
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
  return b.tx(() => {
    const tid = t.transfer_id ?? uid();
    b.run('delete from transactions where transfer_id = ?', [tid]);
    const ins = (acc: string, amount: number, other: string) =>
      b.run(
        `insert into transactions (id, account_id, date, amount, payee, note, transfer_id, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)`,
        [uid(), acc, t.date, amount, `Umbuchung ${amount < 0 ? 'an' : 'von'} ${accts.get(other) ?? ''}`.trim(), t.note ?? null, tid, ts, ts],
      );
    ins(t.from_account, -t.amount, t.to_account);
    ins(t.to_account, t.amount, t.from_account);
    return tid;
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
