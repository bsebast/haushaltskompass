import type { Book } from './core';
import type { Budget, Category } from './types';
import { listCategories, rootOf, descendantIds, listBudgets, listAccounts } from './repo';
import { addMonths, monthRange, daysInMonth, today } from '../lib/dates';

/**
 * Buchungszeilen für Auswertungen: Splits werden aufgelöst, Umbuchungen ausgeschlossen.
 * Spalten: date, month, account_id, category_id, amount
 */
const LINES = `
  with lines as (
    select t.date, substr(t.date, 1, 7) as month, t.account_id, coalesce(s.category_id, t.category_id) as category_id,
           coalesce(s.amount, t.amount) as amount
    from transactions t left join splits s on s.transaction_id = t.id
    where t.transfer_id is null
  )`;

export interface MonthTotals {
  month: string;
  income: number;
  expense: number; // positiv
  net: number;
}

export function monthlyTotals(b: Book, fromMonth: string, toMonth: string, accountId?: string | null): MonthTotals[] {
  const rows = b.all<{ month: string; income: number; expense: number }>(
    `${LINES}
     select month, sum(case when amount > 0 then amount else 0 end) as income, -sum(case when amount < 0 then amount else 0 end) as expense
     from lines where month between ? and ? ${accountId ? 'and account_id = ?' : ''}
     group by month`,
    accountId ? [fromMonth, toMonth, accountId] : [fromMonth, toMonth],
  );
  const map = new Map(rows.map((r) => [r.month, r]));
  const out: MonthTotals[] = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
    const r = map.get(m);
    const income = r?.income ?? 0;
    const expense = r?.expense ?? 0;
    out.push({ month: m, income, expense, net: income - expense });
  }
  return out;
}

export interface CategoryTotal {
  category_id: string | null;
  name: string;
  color: string;
  amount: number; // positiv
  share: number; // 0..1
}

/** Summen je Kategorie (Ausgaben oder Einnahmen), optional auf oberste Ebene verdichtet. */
export function categoryTotals(
  b: Book,
  from: string,
  to: string,
  kind: 'expense' | 'income',
  opts: { rollUp?: boolean; parentId?: string | null; excludeExternal?: boolean } = {},
): CategoryTotal[] {
  const cats = listCategories(b);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const roots = rootOf(cats);
  const rows = b.all<{ category_id: string | null; amount: number }>(
    `${LINES} select category_id, sum(amount) as amount from lines
     where date between ? and ? and amount ${kind === 'expense' ? '<' : '>'} 0
     ${opts.excludeExternal ? 'and account_id not in (select id from accounts where external = 1)' : ''}
     group by category_id`,
    [from, to],
  );
  const agg = new Map<string | null, number>();
  let scope: Set<string> | null = null;
  if (opts.parentId) scope = new Set(descendantIds(cats, opts.parentId));
  for (const r of rows) {
    let key = r.category_id;
    if (scope) {
      if (!key || !scope.has(key)) continue;
      // auf direkte Kinder von parentId verdichten
      let cur = byId.get(key);
      while (cur && cur.parent_id && cur.parent_id !== opts.parentId) cur = byId.get(cur.parent_id);
      key = cur?.id ?? key;
    } else if (opts.rollUp !== false && key) {
      key = roots.get(key) ?? key;
    }
    agg.set(key, (agg.get(key) ?? 0) + Math.abs(r.amount));
  }
  const total = [...agg.values()].reduce((a, v) => a + v, 0) || 1;
  return [...agg.entries()]
    .map(([id, amount]) => {
      const c = id ? byId.get(id) : undefined;
      return { category_id: id, name: c?.name ?? 'Ohne Kategorie', color: c?.color ?? '#8a8478', amount, share: amount / total };
    })
    .sort((a, b) => b.amount - a.amount);
}

/** Kontostand je Konto zu einem Stichtag (letzter Snapshot ≤ Stichtag + Buchungen danach, sonst Anfangssaldo + Buchungen). */
export function balancesAt(b: Book, dates: string[], accountIds?: string[]): Map<string, number[]> {
  // archivierte Konten zählen mit: ihr Verlauf gehört zur Vermögensentwicklung, heute stehen sie meist auf 0.
  // Externe Konten (nur Gegenkonto für Durchbuchungen) zählen nur, wenn sie ausdrücklich angefragt werden.
  const accts = b.all<{ id: string; opening_balance: number; external: number }>('select id, opening_balance, external from accounts')
    .filter((a) => (accountIds ? accountIds.includes(a.id) : !a.external));
  const snaps = b.all<{ account_id: string; date: string; balance: number }>('select account_id, date, balance from balance_snapshots order by date');
  const tx = b.all<{ account_id: string; date: string; s: number; auto: number }>(
    'select account_id, date, sum(amount) as s, sum(case when auto_counterpart = 1 then amount else 0 end) as auto from transactions group by account_id, date order by date');
  const out = new Map<string, number[]>();
  for (const a of accts) {
    const sn = snaps.filter((x) => x.account_id === a.id);
    const tt = tx.filter((x) => x.account_id === a.id);
    out.set(a.id, dates.map((d) => {
      const anchor = [...sn].reverse().find((x) => x.date <= d);
      // automatisch ergänzte Gegenbuchungen am Tag des Snapshots kannte die Bank noch nicht
      if (anchor) return anchor.balance + tt.filter((x) => x.date > anchor.date && x.date <= d).reduce((s, x) => s + x.s, 0)
        + (tt.find((x) => x.date === anchor.date)?.auto ?? 0);
      // vor dem ersten erfassten Kontostand gibt es nur dann Werte, wenn es keine Snapshots gibt
      if (sn.length) return 0;
      return a.opening_balance + tt.filter((x) => x.date <= d).reduce((s, x) => s + x.s, 0);
    }));
  }
  return out;
}

/** Kontostand am Monatsende je Monat (alle aktiven Konten oder eines). */
export function balanceTrend(b: Book, fromMonth: string, toMonth: string, accountId?: string | null): { month: string; balance: number }[] {
  const months: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) months.push(m);
  const ends = months.map((m) => monthRange(m).to);
  const per = balancesAt(b, ends, accountId ? [accountId] : undefined);
  return months.map((month, i) => ({ month, balance: [...per.values()].reduce((s, arr) => s + arr[i], 0) }));
}

export interface MonthLeft {
  month: string;
  income: number;
  expense: number;
  left: number;
  /** grobe Hochrechnung bis Monatsende, nur für den laufenden Monat */
  projectedLeft: number | null;
  avgExpense3: number;
}

export function monthLeft(b: Book, month: string): MonthLeft {
  const [cur] = monthlyTotals(b, month, month);
  const prev = monthlyTotals(b, addMonths(month, -3), addMonths(month, -1));
  const avgExpense3 = Math.round(prev.reduce((a, m) => a + m.expense, 0) / 3);
  let projectedLeft: number | null = null;
  const t = today();
  if (t.startsWith(month)) {
    const day = Number(t.slice(8, 10));
    const dim = daysInMonth(month);
    const projectedExpense = Math.max(cur.expense, Math.round((cur.expense / day) * dim));
    projectedLeft = cur.income - projectedExpense;
  }
  return { month, income: cur.income, expense: cur.expense, left: cur.net, projectedLeft, avgExpense3 };
}

export interface BudgetStatus {
  budget: Budget;
  category: Category;
  limit: number;
  spent: number;
  ratio: number;
  /** erwarteter Anteil zum heutigen Tag (für laufende Zeiträume) */
  expectedRatio: number | null;
  state: 'ok' | 'warn' | 'over';
}

export function budgetStatus(b: Book, month: string): BudgetStatus[] {
  const cats = listCategories(b);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: BudgetStatus[] = [];
  for (const bu of listBudgets(b)) {
    if (bu.valid_from > month || (bu.valid_to && bu.valid_to < month)) continue;
    const cat = byId.get(bu.category_id);
    if (!cat) continue;
    const range = bu.period === 'month' ? monthRange(month) : { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
    const ids = descendantIds(cats, cat.id);
    const q = ids.map(() => '?').join(',');
    const net = (b.value<number>(
      `${LINES} select coalesce(sum(amount), 0) from lines where date between ? and ? and category_id in (${q})`,
      [range.from, range.to, ...ids],
    ) ?? 0) as number;
    const spent = cat.kind === 'expense' ? Math.max(0, -net) : Math.max(0, net);
    const ratio = spent / bu.amount;
    let expectedRatio: number | null = null;
    const t = today();
    if (t >= range.from && t <= range.to) {
      const start = new Date(range.from + 'T00:00:00Z').getTime();
      const end = new Date(range.to + 'T00:00:00Z').getTime() + 86400000;
      const nowT = new Date(t + 'T00:00:00Z').getTime() + 86400000;
      expectedRatio = (nowT - start) / (end - start);
    }
    const state = ratio > 1 ? 'over' : ratio > 0.9 || (expectedRatio !== null && ratio > expectedRatio + 0.1) ? 'warn' : 'ok';
    out.push({ budget: bu, category: cat, limit: bu.amount, spent, ratio, expectedRatio, state });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

export interface SavingHint {
  kind: 'increase' | 'largest' | 'subscriptions';
  title: string;
  detail: string;
  category_id?: string | null;
  amount: number;
}

/** Hinweise auf Sparpotenzial: größte Kostenblöcke und Kategorien, die deutlich über dem eigenen Durchschnitt liegen. */
export function savingHints(b: Book, month: string): SavingHint[] {
  const hints: SavingHint[] = [];
  const r = monthRange(month);
  const cur = categoryTotals(b, r.from, r.to, 'expense');
  const prevFrom = monthRange(addMonths(month, -6)).from;
  const prevTo = monthRange(addMonths(month, -1)).to;
  const prev = new Map(categoryTotals(b, prevFrom, prevTo, 'expense').map((c) => [c.category_id, c.amount / 6]));
  for (const c of cur) {
    const avg = prev.get(c.category_id) ?? 0;
    if (avg > 0 && c.amount > avg * 1.25 && c.amount - avg > 2000) {
      hints.push({
        kind: 'increase',
        title: `${c.name} liegt über deinem Schnitt`,
        detail: `${Math.round((c.amount / avg - 1) * 100)} % mehr als im Durchschnitt der letzten 6 Monate.`,
        category_id: c.category_id,
        amount: c.amount - Math.round(avg),
      });
    }
  }
  cur.slice(0, 3).forEach((c) =>
    hints.push({
      kind: 'largest',
      title: `${c.name}: ${Math.round(c.share * 100)} % deiner Ausgaben`,
      detail: 'Einer der größten Kostenblöcke in diesem Monat.',
      category_id: c.category_id,
      amount: c.amount,
    }),
  );
  return hints;
}

export function netWorth(b: Book): number {
  return listAccounts(b).filter((x) => !x.external).reduce((a, x) => a + x.balance, 0);
}
