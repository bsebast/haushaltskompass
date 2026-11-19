import Papa from 'papaparse';
import type { Book } from './core';
import type { Category } from './types';
import { listCategories, saveCategory, categoryTree, flattenTree } from './repo';
import { uid, now } from '../lib/id';
import { parseAmount } from '../lib/money';
import { today, ymd } from '../lib/dates';

export type Interval = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export const INTERVALS: Record<Interval, string> = {
  monthly: 'monatlich',
  quarterly: 'vierteljährlich',
  halfyearly: 'halbjährlich',
  yearly: 'jährlich',
};

const PER_YEAR: Record<Interval, number> = { monthly: 12, quarterly: 4, halfyearly: 2, yearly: 1 };

export interface Contract {
  id: string;
  name: string;
  payee: string;
  person: string | null;
  purpose: string | null;
  kind: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  account_id: string | null;
  account_name: string | null;
  amount: number; // negativ = Ausgabe
  interval: Interval;
  due_day: number | null;
  due_months: string | null; // "1,4,7,10"
  payment_method: string | null;
  note: string | null;
  start_date: string | null;
  end_date: string | null;
  notice_period: string | null;
  doc_ref: string | null;
  advisor: string | null;
  death_action: string | null;
  status: 'suggested' | 'confirmed' | 'ended' | 'dismissed';
}

export function listContracts(b: Book, includeEnded = false): Contract[] {
  return b.all<Contract>(
    `select r.*, coalesce(r.name, r.payee) as name, c.name as category_name, c.color as category_color, a.name as account_name
     from recurring r left join categories c on c.id = r.category_id left join accounts a on a.id = r.account_id
     where r.status ${includeEnded ? "in ('confirmed','ended')" : "= 'confirmed'"}
     order by r.status, coalesce(r.kind, 'zzz'), coalesce(r.name, r.payee) collate nocase`,
  );
}

export interface ContractInput {
  id?: string;
  name: string;
  person?: string | null;
  purpose?: string | null;
  kind?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  amount: number;
  interval: Interval;
  due_day?: number | null;
  due_months?: number[] | null;
  payment_method?: string | null;
  note?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notice_period?: string | null;
  doc_ref?: string | null;
  advisor?: string | null;
  death_action?: string | null;
  status?: 'confirmed' | 'ended';
}

export function saveContract(b: Book, c: ContractInput): string {
  const name = c.name.trim();
  if (!name) throw new Error('Bitte einen Namen für den Vertrag eingeben.');
  if (!Number.isInteger(c.amount) || c.amount === 0) throw new Error('Bitte einen Betrag eingeben.');
  if (c.due_day != null && (c.due_day < 1 || c.due_day > 31)) throw new Error('Der Fälligkeitstag muss zwischen 1 und 31 liegen.');
  const months = c.due_months?.length ? normalizeMonths(c.interval, c.due_months).join(',') : null;
  const t = now();
  const vals = [
    name, name, c.person ?? null, c.purpose ?? null, c.kind ?? null, c.category_id ?? null, c.account_id ?? null, c.amount, c.interval,
    c.due_day ?? null, months, c.payment_method ?? null, c.note ?? null, c.start_date ?? null, c.end_date ?? null,
    c.notice_period ?? null, c.doc_ref ?? null, c.advisor ?? null, c.death_action ?? null, c.status ?? 'confirmed', t,
  ];
  if (c.id) {
    b.run(
      `update recurring set name=?, payee=?, person=?, purpose=?, kind=?, category_id=?, account_id=?, amount=?, interval=?, due_day=?, due_months=?,
       payment_method=?, note=?, start_date=?, end_date=?, notice_period=?, doc_ref=?, advisor=?, death_action=?, status=?, updated_at=? where id=?`,
      [...vals, c.id],
    );
    return c.id;
  }
  const id = uid();
  b.run(
    `insert into recurring (name, payee, person, purpose, kind, category_id, account_id, amount, interval, due_day, due_months,
      payment_method, note, start_date, end_date, notice_period, doc_ref, advisor, death_action, status, updated_at, id, created_at)
      values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...vals, id, t],
  );
  return id;
}

export function deleteContract(b: Book, id: string) {
  b.run('delete from recurring where id = ?', [id]);
}

export function perMonth(c: Pick<Contract, 'amount' | 'interval'>): number {
  return Math.round((c.amount * PER_YEAR[c.interval]) / 12);
}

export function perYear(c: Pick<Contract, 'amount' | 'interval'>): number {
  return c.amount * PER_YEAR[c.interval];
}

/** Ergänzt Fälligkeitsmonate: bei vierteljährlich mit nur einem Monat werden die drei weiteren abgeleitet usw. */
export function normalizeMonths(interval: Interval, months: number[]): number[] {
  const uniq = [...new Set(months.filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (!uniq.length || interval === 'monthly') return [];
  const step = 12 / PER_YEAR[interval];
  if (uniq.length === 1 && step < 12) {
    const out: number[] = [];
    for (let k = 0; k < PER_YEAR[interval]; k++) out.push(((uniq[0] - 1 + k * step) % 12) + 1);
    return out.sort((a, b) => a - b);
  }
  return uniq;
}

/** Nächste Fälligkeit ab einem Tag (inklusive). Ohne Angaben: Monatsanfang bzw. Januar. */
export function nextDue(c: Pick<Contract, 'interval' | 'due_day' | 'due_months' | 'end_date'>, from = today()): string | null {
  const day = c.due_day ?? 1;
  let months = c.due_months ? c.due_months.split(',').map(Number) : [];
  if (c.interval !== 'monthly' && !months.length) months = normalizeMonths(c.interval, [1]);
  const [fy, fm] = from.split('-').map(Number);
  for (let k = 0; k < 24; k++) {
    const idx = fy * 12 + (fm - 1) + k;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    if (c.interval !== 'monthly' && !months.includes(m)) continue;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = ymd(y, m, Math.min(day, dim));
    if (d >= from) return c.end_date && d > c.end_date ? null : d;
  }
  return null;
}

export function upcoming(contracts: Contract[], days: number, from = today()): { contract: Contract; date: string }[] {
  const end = new Date(from + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + days);
  const to = end.toISOString().slice(0, 10);
  return contracts
    .map((contract) => ({ contract, date: nextDue(contract, from) }))
    .filter((x): x is { contract: Contract; date: string } => !!x.date && x.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- Import ---------- */

export function parseInterval(s: string | undefined | null): Interval | null {
  const v = (s ?? '').toLowerCase().trim();
  if (!v) return null;
  if (/^monat|^mtl|^monthly/.test(v)) return 'monthly';
  if (/viertel|quartal|^quarter/.test(v)) return 'quarterly';
  if (/halbj|^half/.test(v)) return 'halfyearly';
  if (/^j(ä|ae)hr|^jährl|^yearly|^annual/.test(v)) return 'yearly';
  return null;
}

/** "01." → Tag 1; "01.01." → Tag 1, Januar; "19.02., 15.05., 15.08." → Tag 19, Monate 2,5,8 */
export function parseDue(s: string | undefined | null): { day: number | null; months: number[] } {
  const v = (s ?? '').trim();
  const parts = [...v.matchAll(/(\d{1,2})\.(?:\s*(\d{1,2})\.?)?/g)];
  if (!parts.length) return { day: null, months: [] };
  const day = Number(parts[0][1]);
  const months = parts.map((p) => (p[2] ? Number(p[2]) : NaN)).filter((m) => !Number.isNaN(m));
  return { day: day >= 1 && day <= 31 ? day : null, months };
}

export interface ImportRow {
  line: number;
  input: ContractInput;
  categoryLabel: string | null;
  warning?: string;
  skip?: boolean;
  duplicate?: boolean;
}

const COLS: Record<string, string[]> = {
  name: ['vertrag', 'name', 'bezeichnung', 'anbieter'],
  person: ['vertragspartner', 'person', 'inhaber', 'für'],
  purpose: ['zweck', 'beschreibung'],
  amount: ['betrag', 'summe'],
  interval: ['rhythmus', 'rhymus', 'intervall', 'turnus'],
  due: ['fälligkeit', 'faelligkeit', 'fällig'],
  payment: ['zahlart', 'zahlungsart'],
  kind: ['art', 'typ'],
  category: ['kategorie'],
  account: ['konto'],
  note: ['bemerkung', 'anmerkung', 'notiz'],
  income: ['einnahme'],
};

function pick(row: Record<string, string>, key: keyof typeof COLS): string {
  for (const [k, v] of Object.entries(row)) {
    if (COLS[key].includes(k.trim().toLowerCase())) return (v ?? '').trim();
  }
  return '';
}

function findCategory(cats: Category[], label: string): Category | null {
  const flat = flattenTree(categoryTree(cats));
  const norm = (s: string) => s.toLowerCase().replace(/\s*(›|>|\/)\s*/g, ' › ').trim();
  const l = norm(label);
  return flat.find((c) => norm(c.path) === l) ?? (flat.filter((c) => norm(c.name) === l).length === 1 ? flat.find((c) => norm(c.name) === l)! : null);
}

/** Liest eine CSV-Datei mit Verträgen (Spalten wie Vertrag; Vertragspartner; Zweck; Betrag; Rhythmus; Fälligkeit; Zahlart; Art; Kategorie; Bemerkung). */
export function parseContractsCsv(b: Book, text: string): ImportRow[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', delimiter: '' });
  const cats = listCategories(b);
  const existing = listContracts(b, true);
  const seen = new Set(existing.map((c) => contractKey(c.name, c.person, c.purpose, c.amount)));
  return res.data.map((row, i) => {
    const name = pick(row, 'name');
    const parsedAmount = parseAmount(pick(row, 'amount'));
    const isIncome = /^(ja|x|1|true|einnahme)$/i.test(pick(row, 'income'));
    const interval = parseInterval(pick(row, 'interval'));
    const due = parseDue(pick(row, 'due'));
    const categoryLabel = pick(row, 'category') || null;
    const cat = categoryLabel ? findCategory(cats, categoryLabel) : null;
    const amount = parsedAmount == null ? 0 : (isIncome ? 1 : -1) * Math.abs(parsedAmount);
    const input: ContractInput = {
      name, person: pick(row, 'person') || null, purpose: pick(row, 'purpose') || null, kind: pick(row, 'kind') || null,
      category_id: cat?.id ?? null, amount, interval: interval ?? 'monthly', due_day: due.day, due_months: due.months,
      payment_method: pick(row, 'payment') || null, note: pick(row, 'note') || null, status: 'confirmed',
    };
    const out: ImportRow = { line: i + 2, input, categoryLabel };
    if (!name) { out.skip = true; out.warning = 'kein Name'; }
    else if (!amount) { out.skip = true; out.warning = 'Betrag fehlt oder ist 0'; }
    else if (!interval) out.warning = `Rhythmus „${pick(row, 'interval')}“ unbekannt, monatlich angenommen`;
    else if (categoryLabel && !cat) out.warning = `Kategorie „${categoryLabel}“ wird neu angelegt`;
    if (!out.skip && seen.has(contractKey(name, input.person, input.purpose, amount))) { out.skip = true; out.duplicate = true; out.warning = 'schon vorhanden'; }
    return out;
  });
}

export function contractKey(name: string, person: string | null | undefined, purpose: string | null | undefined, amount: number) {
  return `${name}|${person ?? ''}|${purpose ?? ''}|${amount}`.toLowerCase();
}

/** Kategorie per Bezeichnung finden oder anlegen ("Ober › Unter" legt beide Ebenen an). */
export function resolveCategory(b: Book, label: string | null | undefined, kind: 'income' | 'expense'): string | null {
  if (!label) return null;
  const found = findCategory(listCategories(b), label);
  if (found) return found.id;
  const parts = label.split(/\s*(?:›|>|\/)\s*/).filter(Boolean);
  let parent: string | null = null;
  for (let k = 0; k < parts.length; k++) {
    const hit = findCategory(listCategories(b), parts.slice(0, k + 1).join(' › '));
    parent = hit ? hit.id : saveCategory(b, { name: parts[k], kind, parent_id: parent });
  }
  return parent;
}

/** Übernimmt die Zeilen; fehlende Kategorien werden angelegt ("Ober › Unter" legt beide Ebenen an). */
export function commitContracts(b: Book, rows: ImportRow[], accountId: string | null): number {
  let n = 0;
  b.tx(() => {
    for (const r of rows) {
      if (r.skip) continue;
      const categoryId = r.input.category_id ?? resolveCategory(b, r.categoryLabel, r.input.amount > 0 ? 'income' : 'expense');
      saveContract(b, { ...r.input, category_id: categoryId, account_id: r.input.account_id ?? accountId });
      n++;
    }
  });
  return n;
}
