import type { Book } from './core';
import type { Category } from './types';
import { listCategories, descendantIds, rootOf, listHoldings } from './repo';
import { balancesAt } from './reports';
import { listContracts, perMonth } from './contracts';
import { addMonths, monthRange, today } from '../lib/dates';

/** Flexible Auswertungen über alle Buchungszeilen (Splits aufgelöst, Umbuchungen ausgeschlossen). */

export type Granularity = 'month' | 'quarter' | 'year';

export interface ReportFilter {
  from: string;
  to: string;
  accountIds?: string[];
  owners?: string[];
  categoryId?: string | null;
  search?: string;
  /** Kategorien unter „Sparen & Anlegen“ als Sparen statt als Ausgabe werten (Standard: ja) */
  savingsAsSaving?: boolean;
  /** Buchungen ohne Kategorie weglassen (z. B. nicht erkannte Überweisungen zwischen eigenen Konten) */
  hideUncategorized?: boolean;
}

export interface Line {
  /** ID der Buchung (bei aufgeteilten Buchungen hat jede Teilzeile dieselbe ID) */
  id: string;
  date: string;
  month: string;
  account_id: string;
  owner: string | null;
  category_id: string | null;
  root_id: string | null;
  amount: number;
  payee: string | null;
  fixed: boolean;
  kind: 'income' | 'expense' | 'saving';
}

const SAVING = /sparen|anlegen|geldanlage|vermögensaufbau/i;

/** Kategorie-IDs, die als Sparen zählen (Name passt, inklusive Unterkategorien). */
export function savingCategoryIds(cats: Category[]): Set<string> {
  const out = new Set<string>();
  for (const c of cats) if (c.kind === 'expense' && SAVING.test(c.name)) descendantIds(cats, c.id).forEach((id) => out.add(id));
  return out;
}

export function reportLines(b: Book, f: ReportFilter): Line[] {
  const where = ['t.transfer_id is null', 't.date between ? and ?'];
  const p: (string | number)[] = [f.from, f.to];
  if (f.accountIds?.length) { where.push(`t.account_id in (${f.accountIds.map(() => '?').join(',')})`); p.push(...f.accountIds); }
  if (f.owners?.length) {
    const named = f.owners.filter((o) => o !== '');
    const parts = [];
    if (named.length) { parts.push(`a.owner in (${named.map(() => '?').join(',')})`); p.push(...named); }
    if (f.owners.includes('')) parts.push("coalesce(a.owner, '') = ''");
    where.push(`(${parts.join(' or ')})`);
  }
  if (f.search?.trim()) {
    for (const term of f.search.trim().toLowerCase().split(/\s+/)) {
      where.push("(lower(coalesce(t.payee,'')) like ? or lower(coalesce(t.purpose,'')) like ? or lower(coalesce(t.note,'')) like ?)");
      p.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }
  }
  const rows = b.all<{ id: string; date: string; account_id: string; owner: string | null; category_id: string | null; amount: number; payee: string | null; recurring_id: string | null }>(
    `select t.id, t.date, t.account_id, a.owner, coalesce(s.category_id, t.category_id) as category_id, coalesce(s.amount, t.amount) as amount, t.payee, t.recurring_id
     from transactions t join accounts a on a.id = t.account_id left join splits s on s.transaction_id = t.id
     where ${where.join(' and ')} order by t.date`,
    p,
  );
  const cats = listCategories(b);
  const roots = rootOf(cats);
  const saving = f.savingsAsSaving === false ? new Set<string>() : savingCategoryIds(cats);
  const scope = f.categoryId ? new Set(descendantIds(cats, f.categoryId)) : null;
  return rows
    .filter((r) => !scope || (r.category_id && scope.has(r.category_id)))
    .filter((r) => !f.hideUncategorized || r.category_id)
    .map((r) => ({
      id: r.id, date: r.date, month: r.date.slice(0, 7), account_id: r.account_id, owner: r.owner, category_id: r.category_id,
      root_id: r.category_id ? roots.get(r.category_id) ?? r.category_id : null, amount: r.amount, payee: r.payee,
      fixed: !!r.recurring_id,
      kind: r.amount > 0 ? 'income' : r.category_id && saving.has(r.category_id) ? 'saving' : 'expense',
    }));
}

/* ---------- Perioden ---------- */

export function periodKey(month: string, g: Granularity): string {
  if (g === 'year') return month.slice(0, 4);
  if (g === 'quarter') return `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
  return month;
}

export function periodsBetween(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) {
    const k = periodKey(m, g);
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export function periodLabel(k: string): string {
  if (/^\d{4}$/.test(k)) return k;
  if (k.includes('-Q')) return `${k.slice(6)}. Q ${k.slice(2, 4)}`.replace('Q', 'Qu.');
  return `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
}

/* ---------- Cashflow ---------- */

export interface CashflowRow { period: string; income: number; expense: number; saving: number; net: number; fixed: number; variable: number; rate: number | null }

export function cashflow(lines: Line[], periods: string[], g: Granularity): CashflowRow[] {
  const map = new Map(periods.map((k) => [k, { period: k, income: 0, expense: 0, saving: 0, net: 0, fixed: 0, variable: 0, rate: null as number | null }]));
  for (const l of lines) {
    const r = map.get(periodKey(l.month, g));
    if (!r) continue;
    if (l.kind === 'income') r.income += l.amount;
    else if (l.kind === 'saving') r.saving -= l.amount;
    else {
      r.expense -= l.amount;
      if (l.fixed) r.fixed -= l.amount; else r.variable -= l.amount;
    }
  }
  return [...map.values()].map((r) => ({ ...r, net: r.income - r.expense - r.saving, rate: r.income > 0 ? (r.income - r.expense) / r.income : null }));
}

export function sumCashflow(rows: CashflowRow[]): CashflowRow {
  const s = rows.reduce((a, r) => ({ ...a, income: a.income + r.income, expense: a.expense + r.expense, saving: a.saving + r.saving, fixed: a.fixed + r.fixed, variable: a.variable + r.variable }),
    { period: 'Summe', income: 0, expense: 0, saving: 0, net: 0, fixed: 0, variable: 0, rate: null as number | null });
  return { ...s, net: s.income - s.expense - s.saving, rate: s.income > 0 ? (s.income - s.expense) / s.income : null };
}

/* ---------- Pivot Kategorie × Periode ---------- */

export interface PivotRow {
  id: string | null;
  name: string;
  color: string;
  depth: number;
  hasChildren: boolean;
  cells: number[];
  total: number;
  avg: number;
}

/**
 * Ausgaben (oder Einnahmen) je Kategorie und Periode. Oberkategorien sind Summen, aufgeklappte zeigen ihre Unterkategorien.
 * Beträge positiv.
 */
export function pivot(b: Book, lines: Line[], periods: string[], g: Granularity, kind: 'expense' | 'income', expanded: Set<string>): PivotRow[] {
  const cats = listCategories(b);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const idx = new Map(periods.map((k, i) => [k, i]));
  const leaf = new Map<string, number[]>(); // category_id (or '') → cells
  for (const l of lines) {
    if (kind === 'income' ? l.kind !== 'income' : l.kind === 'income') continue;
    const i = idx.get(periodKey(l.month, g));
    if (i === undefined) continue;
    const key = l.category_id ?? '';
    const arr = leaf.get(key) ?? periods.map(() => 0);
    arr[i] += Math.abs(l.amount);
    leaf.set(key, arr);
  }
  const subtotal = (id: string) => {
    const ids = new Set(descendantIds(cats, id));
    const cells = periods.map(() => 0);
    for (const [k, arr] of leaf) if (ids.has(k)) arr.forEach((v, i) => { cells[i] += v; });
    return cells;
  };
  const mk = (c: Category | null, depth: number, cells: number[]): PivotRow => {
    const total = cells.reduce((a, v) => a + v, 0);
    return {
      id: c?.id ?? null, name: c?.name ?? 'Ohne Kategorie', color: c?.color ?? '#8a8478', depth,
      hasChildren: !!c && cats.some((x) => x.parent_id === c.id), cells, total, avg: Math.round(total / Math.max(1, periods.length)),
    };
  };
  const out: PivotRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = cats.filter((c) => c.parent_id === parent && c.kind === (kind === 'income' ? 'income' : 'expense'));
    const rows = children.map((c) => mk(c, depth, depth === 0 || cats.some((x) => x.parent_id === c.id) ? subtotal(c.id) : leaf.get(c.id) ?? periods.map(() => 0)))
      .filter((r) => r.total !== 0).sort((x, y) => y.total - x.total);
    for (const r of rows) {
      out.push(r);
      if (r.id && expanded.has(r.id) && r.hasChildren) {
        walk(r.id, depth + 1);
        // Beträge direkt auf der Oberkategorie
        const own = leaf.get(r.id);
        if (own && own.some((v) => v)) out.push({ ...mk(byId.get(r.id)!, depth + 1, own), name: `${r.name} (direkt)`, hasChildren: false, id: `${r.id}#own` });
      }
    }
  };
  walk(null, 0);
  // Buchungen auf Kategorien der anderen Art (z. B. Steuererstattung auf einer Ausgabenkategorie)
  const want = kind === 'income' ? 'income' : 'expense';
  const rest = periods.map(() => 0);
  for (const [k, arr] of leaf) if (k && byId.get(k) && byId.get(k)!.kind !== want) arr.forEach((v, i) => { rest[i] += v; });
  if (rest.some((v) => v)) out.push({ ...mk(null, 0, rest), name: kind === 'income' ? 'Erstattungen auf Ausgabenkategorien' : 'Abflüsse auf Einnahmenkategorien', id: '#other' });
  const none = leaf.get('');
  if (none && none.some((v) => v)) out.push(mk(null, 0, none));
  return out;
}

/* ---------- Vergleich mit Vorjahr ---------- */

export interface CompareRow { id: string | null; name: string; color: string; current: number; previous: number; diff: number; pct: number | null }

export function shiftYear(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) + years;
  const md = date.slice(5);
  if (md === '02-29') return `${y}-02-28`;
  return `${y}-${md}`;
}

export function compareByRoot(b: Book, cur: Line[], prev: Line[], kind: 'expense' | 'income'): CompareRow[] {
  const cats = new Map(listCategories(b).map((c) => [c.id, c]));
  const agg = (ls: Line[]) => {
    const m = new Map<string | null, number>();
    for (const l of ls) {
      if (kind === 'income' ? l.kind !== 'income' : l.kind === 'income') continue;
      m.set(l.root_id, (m.get(l.root_id) ?? 0) + Math.abs(l.amount));
    }
    return m;
  };
  const a = agg(cur);
  const p = agg(prev);
  return [...new Set([...a.keys(), ...p.keys()])].map((id) => {
    const c = id ? cats.get(id) : undefined;
    const current = a.get(id) ?? 0;
    const previous = p.get(id) ?? 0;
    return { id, name: c?.name ?? 'Ohne Kategorie', color: c?.color ?? '#8a8478', current, previous, diff: current - previous, pct: previous ? (current - previous) / previous : null };
  }).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}

/* ---------- Empfänger ---------- */

export interface PayeeRow { payee: string; count: number; expense: number; income: number; last: string }

export function topPayees(lines: Line[], limit = 50): PayeeRow[] {
  const m = new Map<string, PayeeRow>();
  for (const l of lines) {
    const k = (l.payee ?? 'Unbekannt').trim();
    const r = m.get(k) ?? { payee: k, count: 0, expense: 0, income: 0, last: l.date };
    r.count++;
    if (l.amount < 0) r.expense -= l.amount; else r.income += l.amount;
    if (l.date > r.last) r.last = l.date;
    m.set(k, r);
  }
  return [...m.values()].sort((x, y) => (y.expense + y.income) - (x.expense + x.income)).slice(0, limit);
}

/* ---------- Fixkosten: Plan gegen Ist ---------- */

export interface ContractActual { id: string; name: string; planned: number; actual: number; count: number }

/** Je Vertrag: geplante Kosten im Zeitraum (anteilig je Monat) und tatsächlich zugeordnete Buchungen. */
export function contractsPlanVsActual(b: Book, f: ReportFilter): ContractActual[] {
  // geplant nur bis heute, sonst zählen künftige Monate als „fehlende Buchung“
  const until = f.to > today() ? today() : f.to;
  const months = until < f.from ? 0 : periodsBetween(f.from, until, 'month').length;
  const actual = b.all<{ recurring_id: string; s: number; n: number }>(
    `select recurring_id, -sum(amount) as s, count(*) as n from transactions where recurring_id is not null and date between ? and ? group by recurring_id`, [f.from, f.to]);
  const am = new Map(actual.map((r) => [r.recurring_id, r]));
  return listContracts(b).filter((c) => c.amount < 0).map((c) => ({
    id: c.id, name: c.person ? `${c.name} (${c.person})` : c.name, planned: Math.round(-perMonth(c) * months),
    actual: am.get(c.id)?.s ?? 0, count: am.get(c.id)?.n ?? 0,
  })).sort((x, y) => y.planned - x.planned);
}

/* ---------- Vermögen ---------- */

export type WealthGroup = 'type' | 'owner' | 'account';

export interface WealthSeries { keys: string[]; rows: Record<string, number | string>[]; depotValue: number; depotAsOf: string | null }

/** Erster und letzter Tag einer Periode (Monat 2026-03, Quartal 2026-Q1 oder Jahr 2026). */
export function periodBounds(k: string): { from: string; to: string } {
  if (/^\d{4}$/.test(k)) return { from: `${k}-01-01`, to: `${k}-12-31` };
  if (k.includes('-Q')) {
    const q = Number(k.slice(6));
    const y = k.slice(0, 4);
    return { from: monthRange(`${y}-${String(q * 3 - 2).padStart(2, '0')}`).from, to: monthRange(`${y}-${String(q * 3).padStart(2, '0')}`).to };
  }
  return monthRange(k);
}

/** Die Konten der Vermögensauswertung mit ihrem Gruppenschlüssel (Kontoart, Person oder Kontoname). */
export function wealthAccounts(b: Book, f: ReportFilter, group: WealthGroup, labels: { type: Record<string, string> }) {
  let accts = b.all<{ id: string; name: string; type: string; owner: string | null }>('select id, name, type, owner from accounts where external = 0');
  if (f.accountIds?.length) accts = accts.filter((a) => f.accountIds!.includes(a.id));
  if (f.owners?.length) accts = accts.filter((a) => f.owners!.includes(a.owner ?? ''));
  return accts.map((a) => ({ ...a, key: group === 'type' ? labels.type[a.type] ?? a.type : group === 'owner' ? a.owner || 'Ohne Inhaber' : a.name }));
}

/** Kontostände am Periodenende, gruppiert nach Kontoart, Person oder Konto. Depotwerte aus den Depotpositionen (letzter Stand). */
export function wealthSeries(b: Book, fIn: ReportFilter, g: Granularity, group: WealthGroup, labels: { type: Record<string, string> }): WealthSeries {
  const f = { ...fIn, to: fIn.to > today() ? today() : fIn.to };
  const periods = periodsBetween(f.from, f.to, g);
  const ends = periods.map((k) => periodBounds(k).to).map((d) => (d > f.to ? f.to : d));
  const accts = wealthAccounts(b, f, group, labels);
  const per = balancesAt(b, ends, accts.map((a) => a.id));
  const keyOf = (a: (typeof accts)[number]) => a.key;
  const keys = [...new Set(accts.map(keyOf))];
  const rows = periods.map((k, i) => {
    const r: Record<string, number | string> = { period: k };
    for (const key of keys) r[key] = 0;
    for (const a of accts) r[keyOf(a)] = (r[keyOf(a)] as number) + (per.get(a.id)?.[i] ?? 0);
    r.total = keys.reduce((s, key) => s + (r[key] as number), 0);
    return r;
  });
  const holdings = listHoldings(b).filter((h) => (!f.owners?.length || f.owners.includes(h.owner ?? '')));
  const depotValue = holdings.reduce((s, h) => s + (h.market_value ?? 0), 0);
  const depotAsOf = holdings.map((h) => h.as_of).filter(Boolean).sort().pop() ?? null;
  return { keys: keys.filter((k) => rows.some((r) => r[k] !== 0)), rows, depotValue, depotAsOf };
}

/* ---------- Kontoabgleich ---------- */

export interface AuditRow { id: string; name: string; owner: string | null; start: number; income: number; expense: number; transfers: number; end: number; gap: number }

/**
 * Je Konto: Stand vor dem Zeitraum, Zu- und Abflüsse, Stand am Ende. „Abweichung“ ist der Teil der Veränderung,
 * der nicht durch Buchungen erklärt ist (z. B. erfasste Kontostände ohne passende Buchungen).
 */
export function accountAudit(b: Book, f: ReportFilter): AuditRow[] {
  const d = new Date(`${f.from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const before = d.toISOString().slice(0, 10);
  let accts = b.all<{ id: string; name: string; owner: string | null; archived: number }>('select id, name, owner, archived from accounts order by coalesce(owner, \'\'), sort_order, name');
  if (f.accountIds?.length) accts = accts.filter((a) => f.accountIds!.includes(a.id));
  if (f.owners?.length) accts = accts.filter((a) => f.owners!.includes(a.owner ?? ''));
  const bal = balancesAt(b, [before, f.to], accts.map((a) => a.id));
  const sums = b.all<{ account_id: string; inc: number; exp: number; tr: number }>(
    `select account_id, sum(case when transfer_id is null and amount > 0 then amount else 0 end) as inc,
            sum(case when transfer_id is null and amount < 0 then amount else 0 end) as exp,
            sum(case when transfer_id is not null then amount else 0 end) as tr
     from transactions where date between ? and ? group by account_id`, [f.from, f.to]);
  const sm = new Map(sums.map((s) => [s.account_id, s]));
  return accts.map((a) => {
    const [start, end] = bal.get(a.id) ?? [0, 0];
    const s = sm.get(a.id);
    const income = s?.inc ?? 0;
    const expense = -(s?.exp ?? 0);
    const transfers = s?.tr ?? 0;
    return { id: a.id, name: a.name, owner: a.owner, start, income, expense, transfers, end, gap: end - start - income + expense - transfers };
  }).filter((r) => r.start || r.end || r.income || r.expense || r.transfers);
}

/* ---------- Gespeicherte Ansichten (im Haushaltsbuch, also auch in der Sicherung) ---------- */

export interface SavedView { name: string; query: string }

export function listViews(b: Book): SavedView[] {
  try { return JSON.parse(b.meta('report_views') ?? '[]'); } catch { return []; }
}

export function saveView(b: Book, v: SavedView) {
  const name = v.name.trim();
  if (!name) throw new Error('Bitte einen Namen für die Ansicht eingeben.');
  const views = listViews(b).filter((x) => x.name !== name);
  views.push({ name, query: v.query });
  b.setMeta('report_views', JSON.stringify(views));
}

export function deleteView(b: Book, name: string) {
  b.setMeta('report_views', JSON.stringify(listViews(b).filter((x) => x.name !== name)));
}

/* ---------- Geldfluss (woher kommt das Geld, wohin fließt es) ---------- */

export interface FlowNode { name: string; color: string; side: 'in' | 'hub' | 'out'; root: string | null | '#saving' | '#surplus' | '#deficit' | '#other-in' | '#other-out'; amount: number }
export interface MoneyFlow { nodes: FlowNode[]; links: { source: number; target: number; value: number }[]; income: number; outflow: number }

/** Baut die Knoten und Verbindungen für ein Flussdiagramm: Einnahmen je Oberkategorie → Topf → Ausgaben je Oberkategorie, Sparen, Überschuss. */
export function moneyFlow(lines: Line[], cats: Category[], maxPerSide = 8): MoneyFlow {
  const inc = new Map<string | null, number>();
  const out = new Map<string | null, number>();
  let saving = 0;
  for (const l of lines) {
    if (l.kind === 'income') inc.set(l.root_id, (inc.get(l.root_id) ?? 0) + l.amount);
    else if (l.kind === 'saving') saving -= l.amount;
    else out.set(l.root_id, (out.get(l.root_id) ?? 0) - l.amount);
  }
  const name = (id: string | null) => cats.find((c) => c.id === id)?.name ?? 'Ohne Kategorie';
  const color = (id: string | null) => cats.find((c) => c.id === id)?.color ?? '#8a8478';
  const top = (m: Map<string | null, number>) => {
    const arr = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return { head: arr.slice(0, maxPerSide), rest: arr.slice(maxPerSide).reduce((a, [, v]) => a + v, 0) };
  };
  const ti = top(inc);
  const to = top(out);
  const income = [...inc.values()].reduce((a, v) => a + Math.max(0, v), 0);
  const outflow = [...out.values()].reduce((a, v) => a + Math.max(0, v), 0) + Math.max(0, saving);
  const nodes: FlowNode[] = [];
  const links: MoneyFlow['links'] = [];
  const left: FlowNode[] = ti.head.map(([id, v]) => ({ name: name(id), color: color(id), side: 'in' as const, root: id, amount: v }));
  if (ti.rest > 0) left.push({ name: 'Weitere Einnahmen', color: '#8a8478', side: 'in', root: '#other-in', amount: ti.rest });
  if (outflow > income) left.push({ name: 'Aus Rücklagen', color: '#b45309', side: 'in', root: '#deficit', amount: outflow - income });
  const right: FlowNode[] = to.head.map(([id, v]) => ({ name: name(id), color: color(id), side: 'out' as const, root: id, amount: v }));
  if (to.rest > 0) right.push({ name: 'Weitere Ausgaben', color: '#8a8478', side: 'out', root: '#other-out', amount: to.rest });
  if (saving > 0) right.push({ name: 'Sparen & Anlegen', color: '#2f7d6d', side: 'out', root: '#saving', amount: saving });
  if (income > outflow) right.push({ name: 'Überschuss', color: '#5b8c3a', side: 'out', root: '#surplus', amount: income - outflow });
  if (!left.length || !right.length) return { nodes: [], links: [], income, outflow };
  nodes.push(...left);
  const hub = nodes.length;
  nodes.push({ name: 'Verfügbares Geld', color: '#64748b', side: 'hub', root: null, amount: Math.max(income, outflow) });
  left.forEach((n, i) => links.push({ source: i, target: hub, value: n.amount }));
  right.forEach((n) => { nodes.push(n); links.push({ source: hub, target: nodes.length - 1, value: n.amount }); });
  return { nodes, links, income, outflow };
}

/**
 * Kennzahlen eines Zeitraums wie im Reiter Überblick der Auswertungen: Einnahmen, Ausgaben (ohne Sparen & Anlegen),
 * Gespartes und Sparquote = (Einnahmen − Ausgaben) ÷ Einnahmen.
 */
export function periodCashflow(b: Book, from: string, to: string): CashflowRow {
  return sumCashflow(cashflow(reportLines(b, { from, to }), periodsBetween(from, to, 'month'), 'month'));
}

/* ---------- Echte Monatsbilanz (Fix- und Flexkosten) ---------- */

export interface MonthBalance {
  month: string;
  /** gebuchte Einnahmen */
  income: number;
  /** im laufenden Monat: noch erwartete Einnahmen (Ø der drei Vormonate abzüglich schon gebuchter), sonst 0 */
  incomeExpected: number;
  /** Fixkosten aller laufenden Verträge auf den Monat umgerechnet (jährliche Kosten anteilig) */
  fixed: number;
  /** im Monat tatsächlich gebuchte Vertragszahlungen */
  fixedBooked: number;
  /** alle übrigen Ausgaben (ohne Sparen & Anlegen) */
  flex: number;
  /** feste Sparraten laut Verträgen unter Sparen & Anlegen (getrennt von fixed ausgewiesen; Rücklagen-Verträge zählen nicht, die Umlage deckt sie ab) */
  savingPlans: number;
  /** Ø Flexkosten der drei Vormonate */
  flexAvg: number;
  /** Einnahmen (inkl. erwarteter) − umgelegte Fixkosten − feste Sparraten − Flexkosten */
  free: number;
  /** nur im laufenden Monat: verbleibende Tage inkl. heute und was davon je Tag noch frei ist */
  daysLeft: number | null;
  perDay: number | null;
}

/**
 * Markiert Buchungen als Vertragszahlung: verknüpft über recurring_id, oder gleiche Kategorie wie ein Vertrag und
 * dazu Betrag höchstens 15 % (mindestens 1 €) daneben oder Empfänger enthält den Vertragsnamen
 * (z. B. zwei Verträge in einer Abbuchung). So zählen nicht verknüpfte Abbuchungen nicht doppelt.
 */
function contractMatcher(b: Book): (l: Line) => boolean {
  const byCat = new Map<string, { amount: number; token: string | null }[]>();
  for (const c of listContracts(b)) {
    if (c.amount >= 0 || !c.category_id) continue;
    const word = c.name.toLowerCase().match(/[a-zäöüß]{3,}/)?.[0] ?? null;
    byCat.set(c.category_id, [...(byCat.get(c.category_id) ?? []), { amount: c.amount, token: word }]);
  }
  return (l) => {
    if (l.fixed) return true;
    if (l.amount >= 0 || !l.category_id) return false;
    const payee = (l.payee ?? '').toLowerCase();
    return (byCat.get(l.category_id) ?? []).some((c) =>
      Math.abs(l.amount - c.amount) <= Math.max(100, Math.abs(c.amount) * 0.15) || (!!c.token && payee.includes(c.token)));
  };
}

function splitMonth(b: Book, month: string, isFixed: (l: Line) => boolean) {
  const lines = reportLines(b, monthRange(month));
  let income = 0, fixedBooked = 0, flex = 0;
  for (const l of lines) {
    if (l.kind !== 'expense') { if (l.kind === 'income') income += l.amount; continue; }
    if (isFixed(l)) fixedBooked -= l.amount; else flex -= l.amount;
  }
  return { lines, income, fixedBooked, flex };
}

/** Buchungszeilen eines Monats, die als Flex- bzw. Fixkosten zählen (für die Detailansicht). */
export function monthBalanceLines(b: Book, month: string, which: 'flex' | 'fixed'): Line[] {
  const isFixed = contractMatcher(b);
  return reportLines(b, monthRange(month)).filter((l) => l.kind === 'expense' && isFixed(l) === (which === 'fixed'));
}

/**
 * Monatsbilanz, in der Verträge gleichmäßig je Monat zählen: Eine Jahresversicherung belastet jeden Monat mit 1/12,
 * statt den Abbuchungsmonat zu verhageln. Was über die tatsächlich gebuchten Vertragszahlungen hinausgeht,
 * gehört in die Rücklage.
 */
export function monthBalance(b: Book, month: string, at = today()): MonthBalance {
  const { from, to } = monthRange(month);
  const isFixed = contractMatcher(b);
  const cur = splitMonth(b, month, isFixed);
  const saving = savingCategoryIds(listCategories(b));
  const active = listContracts(b).filter((c) => c.amount < 0 && (!c.start_date || c.start_date <= to) && (!c.end_date || c.end_date >= from));
  // Rücklagen für Jahresrechnungen sind dasselbe Geld wie die umgelegten Jahresverträge, also nicht noch einmal abziehen
  const isReserve = (c: { name: string }) => /r(ü|ue)cklage/i.test(c.name);
  const isSaving = (c: { category_id: string | null; name: string }) => !!c.category_id && saving.has(c.category_id) && !isReserve(c);
  const fixed = -Math.round(active.filter((c) => !isSaving(c) && !isReserve(c)).reduce((a, c) => a + perMonth(c, month), 0));
  const savingPlans = -Math.round(active.filter(isSaving).reduce((a, c) => a + perMonth(c, month), 0));
  const prev = [1, 2, 3].map((i) => splitMonth(b, addMonths(month, -i), isFixed));
  const flexAvg = Math.round(prev.reduce((a, p) => a + p.flex, 0) / 3);
  const incomeAvg = Math.round(prev.reduce((a, p) => a + p.income, 0) / 3);
  const running = at >= from && at <= to;
  const incomeExpected = running ? Math.max(0, incomeAvg - cur.income) : 0;
  const free = cur.income + incomeExpected - fixed - savingPlans - cur.flex;
  let daysLeft: number | null = null;
  let perDay: number | null = null;
  if (running) {
    daysLeft = Number(to.slice(8, 10)) - Number(at.slice(8, 10)) + 1;
    perDay = Math.max(0, Math.floor(free / daysLeft));
  }
  return { month, income: cur.income, incomeExpected, fixed, fixedBooked: cur.fixedBooked, flex: cur.flex, flexAvg, savingPlans, free, daysLeft, perDay };
}
