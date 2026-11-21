import type { Book } from './core';
import type { AccountType } from './types';
import { listAccounts } from './repo';
import { listContracts, normalizeMonths, perMonth, type Contract } from './contracts';
import { addMonths, currentMonth } from '../lib/dates';
import { uid } from '../lib/id';

/**
 * Finanzprognose: Wie entwickelt sich der verfügbare Kontostand in den nächsten Monaten?
 *
 * Grundlage ist der Durchschnitt der letzten Monate (alle Ein- und Ausgänge der gewählten Konten,
 * Umbuchungen zwischen diesen Konten zählen nicht). Verträge verteilen sich darin gleichmäßig. Die
 * Prognose setzt sie stattdessen in ihren Fälligkeitsmonat: Eine Jahresprämie erscheint also im
 * fälligen Monat und nicht als Zwölftel. Neue Verträge (Beginn nach dem Rückblick) kommen dazu,
 * beendete fallen weg. Szenarien ergänzen eigene Annahmen.
 */

export const LIQUID_TYPES: AccountType[] = ['checking', 'cash', 'household', 'credit', 'savings'];

export interface ForecastSettings {
  /** null = alle liquiden Konten (Giro, Bargeld, Haushaltskasse, Kreditkarte, Tagesgeld) */
  accountIds: string[] | null;
  /** Monate in die Zukunft */
  months: number;
  /** Monate Rückblick für den Durchschnitt */
  history: number;
  /** Warngrenze für den Gesamtstand (Cent), optional */
  floor: number | null;
  /** Einzelne Ausgaben ab diesem Betrag (Cent) zählen als einmalig und nicht zum Durchschnitt; null = alle zählen */
  oneOff: number | null;
}

export type AdjustmentKind = 'once' | 'monthly' | 'percent';

export interface Adjustment {
  id: string;
  label: string;
  kind: AdjustmentKind;
  /** Betrag in Cent, negativ = Ausgabe (bei once und monthly) */
  amount?: number;
  /** Prozent (bei percent), z. B. 3 für +3 % */
  pct?: number;
  target?: 'income' | 'expense';
  /** erster Monat 'YYYY-MM' */
  from: string;
  /** letzter Monat (nur monthly und percent), leer = unbegrenzt */
  to?: string | null;
}

export interface Scenario {
  id: string;
  name: string;
  adjustments: Adjustment[];
}

export interface ForecastConfig {
  settings: ForecastSettings;
  scenarios: Scenario[];
}

export const DEFAULT_SETTINGS: ForecastSettings = { accountIds: null, months: 24, history: 12, floor: null, oneOff: 500000 };

const KEY = 'forecast';

export function loadForecast(b: Book): ForecastConfig {
  try {
    const raw = b.meta(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<ForecastConfig>;
      return { settings: { ...DEFAULT_SETTINGS, ...c.settings }, scenarios: Array.isArray(c.scenarios) ? c.scenarios : [] };
    }
  } catch { /* beschädigte Einstellung: Standard verwenden */ }
  return { settings: { ...DEFAULT_SETTINGS }, scenarios: [] };
}

export function saveForecast(b: Book, c: ForecastConfig) {
  b.setMeta(KEY, JSON.stringify(c));
}

export function newScenario(name: string): Scenario {
  return { id: uid(), name: name.trim() || 'Szenario', adjustments: [] };
}

export function newAdjustment(a: Omit<Adjustment, 'id'>): Adjustment {
  return { ...a, id: uid() };
}

/* ---------- Berechnung ---------- */

export interface ForecastMonth {
  month: string;
  income: number;
  /** negativ */
  expense: number;
  net: number;
  /** Kontostand am Monatsende */
  balance: number;
  /** davon Verträge im Fälligkeitsmonat (Abweichung vom Durchschnitt) */
  contracts: number;
  /** Wirkung der Szenario-Annahmen */
  extra: number;
}

export interface ForecastBase {
  accountIds: string[];
  start: number;
  /** Rückblick: Monate, Durchschnitt Einnahmen/Ausgaben */
  historyMonths: string[];
  avgIncome: number;
  avgExpense: number;
  /** schon gebucht im laufenden Monat */
  monthIncome: number;
  monthExpense: number;
  /** im Rückblick als einmalig herausgerechnete Ausgaben */
  oneOffs: { id: string; date: string; payee: string | null; amount: number }[];
  contracts: Contract[];
  months: string[];
}

export function scopeAccounts(b: Book, s: ForecastSettings): string[] {
  const all = listAccounts(b).filter((a) => !a.external);
  if (s.accountIds?.length) {
    const ids = new Set(s.accountIds);
    return all.filter((a) => ids.has(a.id)).map((a) => a.id);
  }
  return all.filter((a) => LIQUID_TYPES.includes(a.type)).map((a) => a.id);
}

/** Ein- und Ausgänge je Monat für die Konten; Umbuchungen zwischen ihnen zählen nicht. */
export function monthlyFlows(b: Book, ids: string[], fromMonth: string, toMonth: string, oneOff: number | null = null): Map<string, { income: number; expense: number }> {
  const out = new Map<string, { income: number; expense: number }>();
  if (!ids.length) return out;
  const q = ids.map(() => '?').join(',');
  const rows = b.all<{ m: string; inc: number; exp: number }>(
    `select substr(t.date, 1, 7) as m,
       coalesce(sum(case when t.amount > 0 then t.amount end), 0) as inc,
       coalesce(sum(case when t.amount < 0 then t.amount end), 0) as exp
     from transactions t
     where t.account_id in (${q}) and t.date between ? and ?
       and not (t.transfer_id is not null and exists (
         select 1 from transactions o where o.transfer_id = t.transfer_id and o.id <> t.id and o.account_id in (${q})))
       ${oneOff ? 'and not (t.amount <= ? and t.recurring_id is null and t.transfer_id is null)' : ''}
     group by 1`,
    [...ids, `${fromMonth}-01`, `${toMonth}-31`, ...ids, ...(oneOff ? [-Math.abs(oneOff)] : [])],
  );
  for (const r of rows) out.set(r.m, { income: r.inc, expense: r.exp });
  return out;
}

export function forecastBase(b: Book, s: ForecastSettings, now = currentMonth()): ForecastBase {
  const ids = scopeAccounts(b, s);
  const accounts = listAccounts(b).filter((a) => ids.includes(a.id));
  const start = accounts.reduce((a, x) => a + x.balance, 0);
  const q = ids.map(() => '?').join(',');
  const first = ids.length ? b.value<string>(`select min(date) from transactions where account_id in (${q})`, ids) : undefined;
  const histEnd = addMonths(now, -1);
  let histStart = addMonths(now, -Math.max(1, s.history));
  if (first && first.slice(0, 7) > histStart) histStart = first.slice(0, 7);
  const historyMonths: string[] = [];
  for (let m = histStart; m <= histEnd; m = addMonths(m, 1)) historyMonths.push(m);
  const flows = monthlyFlows(b, ids, histStart, now, s.oneOff);
  const oneOffs = s.oneOff && ids.length
    ? b.all<{ id: string; date: string; payee: string | null; amount: number }>(
      `select id, date, payee, amount from transactions where account_id in (${q}) and date between ? and ? and amount <= ? and recurring_id is null and transfer_id is null order by date`,
      [...ids, `${histStart}-01`, `${histEnd}-31`, -Math.abs(s.oneOff)])
    : [];
  let inc = 0;
  let exp = 0;
  for (const m of historyMonths) { inc += flows.get(m)?.income ?? 0; exp += flows.get(m)?.expense ?? 0; }
  const n = historyMonths.length || 1;
  const cur = flows.get(now) ?? { income: 0, expense: 0 };
  const contracts = listContracts(b).filter((c) => !c.account_id || ids.includes(c.account_id));
  const months: string[] = [];
  for (let k = 0; k <= Math.max(1, s.months); k++) months.push(addMonths(now, k));
  return {
    accountIds: ids, start, historyMonths, avgIncome: historyMonths.length ? Math.round(inc / n) : 0, avgExpense: historyMonths.length ? Math.round(exp / n) : 0,
    monthIncome: cur.income, monthExpense: cur.expense, oneOffs, contracts, months,
  };
}

const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);

/** Ist der Vertrag im Monat fällig? */
export function dueIn(c: Pick<Contract, 'interval' | 'due_months' | 'start_date' | 'end_date'>, month: string): boolean {
  const s = ym(c.start_date);
  const e = ym(c.end_date);
  if ((s && month < s) || (e && month > e)) return false;
  if (c.interval === 'monthly') return true;
  let months = c.due_months ? c.due_months.split(',').map(Number) : [];
  if (!months.length) months = normalizeMonths(c.interval, [1]);
  return months.includes(Number(month.slice(5, 7)));
}

/** Abweichung eines Vertrags vom Durchschnitt im Monat (Cent). */
export function contractDelta(c: Contract, month: string, historyMonths: string[]): number {
  const hs = historyMonths[0];
  const he = historyMonths[historyMonths.length - 1];
  const s = ym(c.start_date);
  const e = ym(c.end_date);
  // im Rückblick enthalten, wenn er in dieser Zeit lief
  const inHistory = !!hs && (!s || s <= he) && (!e || e >= hs);
  return (dueIn(c, month) ? c.amount : 0) - (inHistory ? perMonth(c) : 0);
}

function adjActive(a: Adjustment, month: string): boolean {
  if (a.kind === 'once') return month === a.from;
  return month >= a.from && (!a.to || month <= a.to);
}

export function computeForecast(base: ForecastBase, scenario: Scenario | null): ForecastMonth[] {
  let balance = base.start;
  const adj = scenario?.adjustments ?? [];
  return base.months.map((month, k) => {
    let income = base.avgIncome;
    let expense = base.avgExpense;
    let contracts = 0;
    for (const c of base.contracts) {
      const d = contractDelta(c, month, base.historyMonths);
      contracts += d;
      if (c.amount > 0) income += d; else expense += d;
    }
    let extra = 0;
    for (const a of adj) {
      if (!adjActive(a, month)) continue;
      if (a.kind === 'percent') {
        const p = (a.pct ?? 0) / 100;
        const d = Math.round((a.target === 'income' ? income : expense) * p);
        extra += d;
        if (a.target === 'income') income += d; else expense += d;
      } else {
        const v = a.amount ?? 0;
        extra += v;
        if (v > 0) income += v; else expense += v;
      }
    }
    if (k === 0) {
      // laufender Monat: nur noch das, was bis Monatsende fehlt
      income = Math.max(0, income - base.monthIncome);
      expense = Math.min(0, expense - base.monthExpense);
    }
    const net = income + expense;
    balance += net;
    return { month, income, expense, net, balance, contracts, extra };
  });
}

export interface ForecastSummary { end: number; low: number; lowMonth: string; belowFloor: string | null }

export function summarize(rows: ForecastMonth[], floor: number | null): ForecastSummary {
  let low = Infinity;
  let lowMonth = rows[0]?.month ?? '';
  let belowFloor: string | null = null;
  for (const r of rows) {
    if (r.balance < low) { low = r.balance; lowMonth = r.month; }
    if (floor != null && belowFloor === null && r.balance < floor) belowFloor = r.month;
  }
  return { end: rows[rows.length - 1]?.balance ?? 0, low: Number.isFinite(low) ? low : 0, lowMonth, belowFloor };
}
