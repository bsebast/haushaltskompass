import type { Book } from './core';
import { listAccounts, listHoldings } from './repo';

/** Warngrenzen: Kontostand unter/über einer Grenze, Kurs einer Depotposition unter/über einer Grenze. */

export function setAccountLimits(b: Book, id: string, min: number | null, max: number | null) {
  if (min != null && max != null && min > max) throw new Error('Die Untergrenze muss kleiner sein als die Obergrenze.');
  b.run('update accounts set min_balance = ?, max_balance = ? where id = ?', [min, max, id]);
}

export function setHoldingAlerts(b: Book, id: string, below: number | null, above: number | null) {
  if (below != null && above != null && below > above) throw new Error('Die untere Kursgrenze muss kleiner sein als die obere.');
  b.run('update holdings set alert_below = ?, alert_above = ? where id = ?', [below, above, id]);
}

/** Kurs je Stück in Cent: erfasster Kurs oder Kurswert ÷ Anzahl. */
export function unitPrice(h: { price: number | null; market_value: number | null; quantity: number }): number | null {
  if (h.price != null) return h.price;
  if (h.market_value != null && h.quantity) return Math.round(h.market_value / h.quantity);
  return null;
}

export interface Alert {
  kind: 'account' | 'holding';
  id: string;
  name: string;
  /** below = Grenze unterschritten, above = überschritten */
  dir: 'below' | 'above';
  value: number;
  limit: number;
  as_of: string | null;
}

export function listAlerts(b: Book): Alert[] {
  const out: Alert[] = [];
  for (const a of listAccounts(b)) {
    const min = a.min_balance;
    const max = a.max_balance;
    if (min != null && a.balance < min) out.push({ kind: 'account', id: a.id, name: a.name, dir: 'below', value: a.balance, limit: min, as_of: a.balance_date });
    if (max != null && a.balance > max) out.push({ kind: 'account', id: a.id, name: a.name, dir: 'above', value: a.balance, limit: max, as_of: a.balance_date });
  }
  for (const h of listHoldings(b)) {
    const p = unitPrice(h);
    if (p == null) continue;
    if (h.alert_below != null && p < h.alert_below) out.push({ kind: 'holding', id: h.id, name: h.name, dir: 'below', value: p, limit: h.alert_below, as_of: h.as_of });
    if (h.alert_above != null && p > h.alert_above) out.push({ kind: 'holding', id: h.id, name: h.name, dir: 'above', value: p, limit: h.alert_above, as_of: h.as_of });
  }
  return out;
}
