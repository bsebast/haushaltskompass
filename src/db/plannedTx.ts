import type { Book } from './core';
import type { Contract } from './contracts';
import { listContracts } from './contracts';
import { today, ymd, addMonths } from '../lib/dates';

/**
 * Prognose-Buchungen je Konto: virtuelle, künftige Buchungen aus Verträgen und aus regelmäßig wiederkehrenden
 * Buchungen der Vergangenheit. Sie werden nie gespeichert und zählen in keiner Auswertung oder Ist-Summe.
 *
 * - Verträge (bestätigt, mit diesem Konto): Fälligkeit nach Intervall/Fälligkeitsmonaten. Gibt es schon gebuchte
 *   Zahlungen dazu, kommen Betrag und Tag im Monat aus der letzten Zahlung (genauer als die Vertragsdaten).
 * - Muster: gleiche Gegenseite (bzw. gleiches Gegenkonto bei Umbuchungen), etwa gleicher Betrag, monatlich oder
 *   vierteljährlich. Muster, die schon ein Vertrag abdeckt, entfallen.
 * - Eine Fälligkeit entfällt, wenn um den Termin herum schon eine passende echte Buchung steht.
 */
export interface PlannedTx {
  id: string;
  date: string;
  amount: number;
  payee: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  transfer: boolean;
  source: 'contract' | 'pattern';
  /** Herkunft für den Tooltip, z. B. „Vertrag: Barmenia“ oder „wiederkehrend, monatlich“ */
  label: string;
}

interface HistTx {
  id: string; date: string; amount: number; payee: string | null; category_id: string | null;
  recurring_id: string | null; transfer_id: string | null; counter: string | null; counter_name: string | null;
}

const DAY = 86400000;
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const fromMs = (n: number) => new Date(n).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);

/** Gegenseite vergleichbar machen: Kleinbuchstaben, ohne Ziffern und Satzzeichen, die ersten drei Wörter. */
export function payeeKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[0-9]/g, ' ').replace(/[^a-zäöüß ]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ');
}

/** Gleiche Gegenseite? Erstes Wort genügt („AXA“ ↔ „AXA Krankenversicherung AG“). */
function samePayee(contractKey: string, txKey: string): boolean {
  if (!contractKey || !txKey) return false;
  if (contractKey === txKey) return true;
  const a = contractKey.split(' ')[0];
  return a.length >= 3 && a === txKey.split(' ')[0];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const close = (a: number, b: number, rel = 0.15) => Math.abs(a - b) <= Math.max(100, Math.abs(b) * rel);

function dateIn(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(day, dim));
}

function contractMonths(c: Contract): number[] | null {
  if (c.interval === 'monthly') return null;
  const per: Record<string, number> = { quarterly: 4, halfyearly: 2, yearly: 1 };
  let months = c.due_months ? c.due_months.split(',').map(Number).filter(Boolean) : [];
  if (!months.length) months = [1];
  const n = per[c.interval] ?? 1;
  if (months.length === 1 && n > 1) {
    const step = 12 / n;
    months = Array.from({ length: n }, (_, k) => ((months[0] - 1 + k * step) % 12) + 1);
  }
  return months;
}

export function plannedTransactions(b: Book, accountId: string, until: string, now = today()): PlannedTx[] {
  const acc = b.get<{ type: string; external: number }>('select type, external from accounts where id = ?', [accountId]);
  if (!acc || acc.type === 'depot' || acc.external) return [];
  const histFrom = addDays(now, -400);
  const hist = b.all<HistTx>(
    `select t.id, t.date, t.amount, t.payee, t.category_id, t.recurring_id, t.transfer_id,
       o.account_id as counter, oa.name as counter_name
     from transactions t
     left join transactions o on o.transfer_id = t.transfer_id and o.id <> t.id
     left join accounts oa on oa.id = o.account_id
     where t.account_id = ? and t.date >= ? and t.date <= ?
     order by t.date`,
    [accountId, histFrom, until],
  );
  const cats = new Map(b.all<{ id: string; name: string; color: string | null }>('select id, name, color from categories').map((c) => [c.id, c]));
  const used = new Set<string>(); // echte Buchungen, die schon eine Fälligkeit erfüllt haben
  const out: PlannedTx[] = [];
  const monthStart = now.slice(0, 7);

  /** Steht um den Termin schon eine passende echte Buchung? (verbraucht sie) */
  const fulfilled = (date: string, amount: number, match: (t: HistTx) => boolean, window: number) => {
    const lo = addDays(date, -window);
    const hi = addDays(date, window);
    const hit = hist.find((t) => !used.has(t.id) && t.date >= lo && t.date <= hi && Math.sign(t.amount) === Math.sign(amount) && match(t) && close(t.amount, amount, 0.25));
    if (hit) used.add(hit.id);
    return !!hit;
  };

  const emit = (p: Omit<PlannedTx, 'id' | 'category_name' | 'category_color'>, match: (t: HistTx) => boolean, window: number) => {
    // offene Fälligkeit der letzten Tage, die noch nicht gebucht ist: als heute fällig zeigen
    if (p.date < addDays(now, -5)) return;
    if (fulfilled(p.date, p.amount, match, window)) return;
    const c = p.category_id ? cats.get(p.category_id) : undefined;
    out.push({ ...p, date: p.date < now ? now : p.date, id: `plan:${p.source}:${out.length}`, category_name: c?.name ?? null, category_color: c?.color ?? null });
  };

  /* ---------- Verträge ---------- */
  const contracts = listContracts(b).filter((c) => c.account_id === accountId && c.amount !== 0);
  const coveredKeys: { key: string; amount: number; step: number; ids: Set<string>; dropped: boolean }[] = [];
  const contractPlans: (() => void)[] = [];
  for (const c of contracts) {
    const linked = hist.filter((t) => t.recurring_id === c.id);
    const key = payeeKey(c.payee || c.name);
    const byName = linked.length ? linked
      : hist.filter((t) => !t.transfer_id && samePayee(key, payeeKey(t.payee)) && close(t.amount, c.amount, 0.05));
    const step = c.interval === 'monthly' ? 1 : c.interval === 'quarterly' ? 3 : 0;
    const entry = { key, amount: c.amount, step, ids: new Set(byName.map((t) => t.id)), dropped: false };
    coveredKeys.push(entry);
    const last = byName[byName.length - 1];
    const day = last ? Number(last.date.slice(8, 10)) : (c.due_day ?? 1);
    const amount = last ? last.amount : c.amount;
    const months = contractMonths(c);
    // Gegenseite heißt bei der Bank oft anders (Grundsteuer ↔ Gemeinde): krummer, fast gleicher Betrag zählt auch
    const odd = c.amount % 100 !== 0;
    const match = (t: HistTx) => t.recurring_id === c.id || samePayee(key, payeeKey(t.payee)) || (odd && !t.transfer_id && close(t.amount, amount, 0.01));
    contractPlans.push(() => { if (!entry.dropped) for (let m = monthStart; m <= until.slice(0, 7); m = addMonths(m, 1)) {
      if (months && !months.includes(Number(m.slice(5, 7)))) continue;
      const d = dateIn(m, day);
      if (d > until || (c.start_date && d < c.start_date) || (c.end_date && d > c.end_date)) continue;
      emit({ date: d, amount, payee: c.name || c.payee, category_id: c.category_id ?? last?.category_id ?? null, transfer: false, source: 'contract',
        label: `Vertrag: ${c.name || c.payee}` }, match, months ? 20 : 12);
    } });
  }
  const patternPlans: (() => void)[] = [];

  /* ---------- wiederkehrende Buchungen ---------- */
  const past = hist.filter((t) => t.date <= now);
  const groups = new Map<string, HistTx[]>();
  for (const t of past) {
    const k = t.transfer_id ? (t.counter ? `T:${t.counter}` : '') : payeeKey(t.payee);
    if (!k) continue;
    const key = `${k}|${t.amount < 0 ? '-' : '+'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const [key, all] of groups) {
    if (all.some((t) => coveredKeys.some((c) => c.ids.has(t.id)))) continue;
    const k = key.split('|')[0];
    // Gruppe mit Untergruppen ähnlicher Beträge (z. B. zwei Daueraufträge an dieselbe Stelle)
    const clusters: HistTx[][] = [];
    for (const t of [...all].reverse()) {
      const cl = clusters.find((c) => close(t.amount, median(c.map((x) => x.amount)), 0.1));
      if (cl) cl.push(t); else clusters.push([t]);
    }
    // viele unregelmäßige Buchungen an dieselbe Stelle (Supermarkt, Tankstelle): kein fester Termin
    const groupMonths = new Set(all.map((t) => t.date.slice(0, 7))).size;
    if (all.length > groupMonths * 2.5) continue;
    for (const cl0 of clusters) {
      const cl = cl0.sort((a, b) => a.date.localeCompare(b.date));
      if (coveredKeys.some((c) => close(cl[cl.length - 1].amount, c.amount, 0.05) && samePayee(c.key, k))) continue;
      const months = [...new Set(cl.map((t) => t.date.slice(0, 7)))];
      if (cl.length > months.length * 1.25) continue; // mehrmals im Monat: kein fester Termin (z. B. Supermarkt)
      const last = cl[cl.length - 1];
      const recent = cl.slice(-4);
      const gaps = recent.slice(1).map((t, i) => (toMs(t.date) - toMs(recent[i].date)) / DAY);
      const amount = median(recent.map((t) => t.amount));
      if (!recent.every((t) => close(t.amount, amount, 0.05))) continue;
      let step = 0;
      if (recent.length >= 3 && gaps.every((g) => g >= 25 && g <= 36)) step = 1;
      else if (recent.length >= 2 && gaps.every((g) => g >= 80 && g <= 100)) step = 3;
      if (!step) continue;
      // abgerissene Reihe: letzte Zahlung länger als ein Intervall plus Puffer her
      if ((toMs(now) - toMs(last.date)) / DAY > step * 31 + 15) continue;
      // Bank bucht mehrere Verträge derselben Gegenseite zusammen (z. B. zwei HDI-Verträge in einer Lastschrift):
      // dann gilt die echte Lastschrift, die Verträge mit gleichem Intervall entfallen in der Prognose.
      for (const c of coveredKeys) if (c.step === step && !c.ids.size && samePayee(c.key, k)) c.dropped = true;
      const day = median(recent.map((t) => Number(t.date.slice(8, 10))));
      const t0 = last;
      const name = t0.transfer_id ? `Umbuchung ${t0.amount < 0 ? 'an' : 'von'} ${t0.counter_name ?? 'anderes Konto'}` : t0.payee;
      const match = (t: HistTx) => (t.transfer_id ? `T:${t.counter}` : payeeKey(t.payee)) === k;
      patternPlans.push(() => { for (let m = addMonths(last.date.slice(0, 7), step); m <= until.slice(0, 7); m = addMonths(m, step)) {
        const d = dateIn(m, day);
        if (d > until) continue;
        emit({ date: d, amount, payee: name, category_id: t0.transfer_id ? null : t0.category_id, transfer: !!t0.transfer_id, source: 'pattern',
          label: step === 1 ? 'wiederkehrend, monatlich' : 'wiederkehrend, vierteljährlich' }, match, 12);
      } });
    }
  }
  for (const f of contractPlans) f();
  for (const f of patternPlans) f();
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}
