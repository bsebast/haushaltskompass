import { addMonths, daysInMonth, monthLabel, monthRange, today, ymd } from './dates';

/** Zeitraum der Übersicht: ein Kalendermonat oder das Jahr bis heute (YTD). */
export type Period = { kind: 'month'; month: string } | { kind: 'ytd'; year: number };

export interface PeriodRange {
  from: string;
  /** letzter Tag, der zählt: Monats- bzw. Jahresende, beim laufenden Jahr (YTD) heute */
  to: string;
  /** erster und letzter Monat 'YYYY-MM' */
  fromMonth: string;
  toMonth: string;
  label: string;
  /** Zeitraum enthält heute */
  current: boolean;
}

/** Liest den URL-Wert: 'ytd' (laufendes Jahr), 'ytd-2025' oder '2026-10'. Alles andere: laufender Monat. */
export function parsePeriod(s: string | null | undefined, now = today()): Period {
  if (s === 'ytd') return { kind: 'ytd', year: Number(now.slice(0, 4)) };
  let m = /^ytd-(\d{4})$/.exec(s ?? '');
  if (m) return { kind: 'ytd', year: Math.min(Number(m[1]), Number(now.slice(0, 4))) };
  m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (m && +m[2] >= 1 && +m[2] <= 12) return { kind: 'month', month: s! };
  return { kind: 'month', month: now.slice(0, 7) };
}

/** URL-Wert eines Zeitraums; der laufende Monat ergibt '' (Standard, kein Parameter). */
export function formatPeriod(p: Period, now = today()): string {
  if (p.kind === 'ytd') return p.year === Number(now.slice(0, 4)) ? 'ytd' : `ytd-${p.year}`;
  return p.month === now.slice(0, 7) ? '' : p.month;
}

export function periodRange(p: Period, now = today()): PeriodRange {
  if (p.kind === 'month') {
    const r = monthRange(p.month);
    const current = now >= r.from && now <= r.to;
    return { from: r.from, to: r.to, fromMonth: p.month, toMonth: p.month, label: monthLabel(p.month, true), current };
  }
  const y = String(p.year);
  const current = now.startsWith(y);
  const to = current ? now : `${y}-12-31`;
  return {
    from: `${y}-01-01`, to, fromMonth: `${y}-01`, toMonth: to.slice(0, 7),
    label: current ? `${y} bis heute` : `Jahr ${y}`, current,
  };
}

/** Einen Schritt zurück/vor: Monat ±1 bzw. Jahr ±1. */
export function shiftPeriod(p: Period, n: number): Period {
  return p.kind === 'month' ? { kind: 'month', month: addMonths(p.month, n) } : { kind: 'ytd', year: p.year + n };
}

/** Wechsel Monat ↔ YTD: YTD nimmt das Jahr des Monats, Monat nimmt im laufenden Jahr den aktuellen, sonst den Dezember. */
export function switchKind(p: Period, kind: Period['kind'], now = today()): Period {
  if (p.kind === kind) return p;
  if (kind === 'ytd') return { kind: 'ytd', year: Number((p as { month: string }).month.slice(0, 4)) };
  const y = (p as { year: number }).year;
  return { kind: 'month', month: now.startsWith(String(y)) ? now.slice(0, 7) : `${y}-12` };
}

/** Tag im Monat, höchstens dessen letzter Tag (z. B. 31. → 28./29. im Februar). */
function clampDay(month: string, day: number): string {
  return ymd(Number(month.slice(0, 4)), Number(month.slice(5, 7)), Math.min(day, daysInMonth(month)));
}

/**
 * Vergleichszeitraum für die Übersicht: beim Monat der Vormonat, beim YTD der gleiche Zeitraum im Vorjahr.
 * Läuft der Monat noch, zählt der Vormonat nur bis zum gleichen Tag, damit halbe und ganze Monate nicht verglichen werden.
 */
export function previousRange(p: Period, now = today()): { from: string; to: string; label: string } {
  if (p.kind === 'month') {
    const prev = addMonths(p.month, -1);
    const r = monthRange(prev);
    const running = now.startsWith(p.month);
    const day = Number(now.slice(8, 10));
    return running
      ? { from: r.from, to: clampDay(prev, day), label: `${monthLabel(prev, true).split(' ')[0]} bis zum ${day}.` }
      : { ...r, label: 'Vormonat' };
  }
  const cur = periodRange(p, now);
  const y = p.year - 1;
  const to = clampDay(`${y}-${cur.to.slice(5, 7)}`, Number(cur.to.slice(8, 10)));
  return { from: `${y}-01-01`, to, label: cur.current ? `${y} bis ${formatShort(to)}` : `Jahr ${y}` };
}

function formatShort(d: string): string {
  return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
}
