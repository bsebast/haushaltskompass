import type { Book } from './core';
import { uid, now } from '../lib/id';
import { addMonths, today } from '../lib/dates';
import { listAccounts } from './repo';
import { balancesAt } from './reports';

/**
 * Sparziele: ein Zielbetrag, optional mit Zieldatum. Der Stand kommt entweder aus einem verknüpften Konto
 * (z. B. Tagesgeld „Notgroschen“) oder wird von Hand fortgeschrieben (Einzahlungen).
 */

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  target_date: string | null;
  /** von Hand erfasster Stand (nur ohne verknüpftes Konto) */
  saved: number;
  account_id: string | null;
  account_name: string | null;
  /** Farbrolle 's1' … 's8' (siehe tokens.css) */
  color: string | null;
  note: string | null;
  done: number;
  sort_order: number;
}

export type GoalInput = Pick<SavingsGoal, 'name' | 'target' | 'target_date' | 'saved' | 'account_id' | 'color' | 'note'> & { id?: string; done?: boolean };

export const GOAL_COLORS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const;

export function listGoals(b: Book): SavingsGoal[] {
  return b.all<SavingsGoal>(
    `select g.*, a.name as account_name from savings_goals g left join accounts a on a.id = g.account_id
     order by g.done, g.sort_order, coalesce(g.target_date, '9999') , g.name collate nocase`,
  );
}

export function saveGoal(b: Book, g: GoalInput): string {
  const name = g.name.trim();
  if (!name) throw new Error('Bitte einen Namen für das Sparziel eingeben.');
  if (name.length > 80) throw new Error('Der Name ist zu lang (höchstens 80 Zeichen).');
  if (!Number.isInteger(g.target) || g.target <= 0) throw new Error('Bitte einen Zielbetrag größer als 0 eingeben.');
  if (g.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(g.target_date)) throw new Error('Das Zieldatum ist ungültig.');
  const color = g.color && (GOAL_COLORS as readonly string[]).includes(g.color) ? g.color : null;
  const t = now();
  const vals = [name, g.target, g.target_date || null, g.account_id ? 0 : Math.round(g.saved || 0), g.account_id || null, color, g.note?.trim() || null, g.done ? 1 : 0, t];
  if (g.id) {
    b.run('update savings_goals set name=?, target=?, target_date=?, saved=?, account_id=?, color=?, note=?, done=?, updated_at=? where id=?', [...vals, g.id]);
    return g.id;
  }
  const id = uid();
  if (!vals[5]) vals[5] = GOAL_COLORS[((b.value<number>('select count(*) from savings_goals') ?? 0) as number) % GOAL_COLORS.length];
  const order = (b.value<number>('select coalesce(max(sort_order), 0) + 1 from savings_goals') ?? 1) as number;
  b.run(
    'insert into savings_goals (name, target, target_date, saved, account_id, color, note, done, updated_at, id, sort_order, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
    [...vals, id, order, t],
  );
  return id;
}

export function deleteGoal(b: Book, id: string) {
  b.run('delete from savings_goals where id = ?', [id]);
}

/** Einzahlung (positiv) oder Entnahme (negativ) bei einem Ziel ohne verknüpftes Konto. */
export function depositGoal(b: Book, id: string, amount: number) {
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Bitte einen Betrag eingeben.');
  const g = b.get<{ account_id: string | null }>('select account_id from savings_goals where id = ?', [id]);
  if (!g) throw new Error('Das Sparziel gibt es nicht mehr.');
  if (g.account_id) throw new Error('Der Stand dieses Ziels kommt aus dem verknüpften Konto.');
  b.run('update savings_goals set saved = max(0, saved + ?), updated_at = ? where id = ?', [amount, now(), id]);
}

/** Farbe eines Ziels als CSS-Wert der Farbrolle; ohne Wahl reihum nach Position. */
export function goalColor(g: Pick<SavingsGoal, 'color'>, index: number): string {
  const role = g.color ?? GOAL_COLORS[index % GOAL_COLORS.length];
  return `rgb(var(--c-${role}))`;
}

/** Ganze Monate vom laufenden Monat bis zum Zielmonat (Zielmonat zählt mit, solange er nicht vorbei ist). */
export function monthsUntil(targetDate: string, from = today()): number {
  const [ty, tm] = targetDate.split('-').map(Number);
  const [fy, fm] = from.split('-').map(Number);
  return ty * 12 + tm - (fy * 12 + fm) + 1;
}

export interface GoalProgress {
  goal: SavingsGoal;
  /** aktueller Stand */
  current: number;
  ratio: number;
  remaining: number;
  reached: boolean;
  /** verbleibende Monate bis zum Zieldatum (inkl. laufendem Monat), null ohne Datum */
  monthsLeft: number | null;
  /** nötige Sparrate je Monat, um das Datum zu halten */
  perMonth: number | null;
  /** Zieldatum vorbei, Ziel nicht erreicht */
  overdue: boolean;
  /** durchschnittlicher Zuwachs je Monat der letzten 6 Monate (nur mit Konto) */
  pace: number | null;
  /** voraussichtlicher Monat 'YYYY-MM' beim bisherigen Tempo (nur mit Konto) */
  eta: string | null;
}

const PACE_MONTHS = 6;

export function goalProgress(b: Book, goals: SavingsGoal[], day = today()): GoalProgress[] {
  const linked = [...new Set(goals.map((g) => g.account_id).filter((x): x is string => !!x))];
  const accounts = new Map(listAccounts(b, true).map((a) => [a.id, a.balance]));
  const then = new Date(day + 'T00:00:00Z');
  then.setUTCMonth(then.getUTCMonth() - PACE_MONTHS);
  const past = linked.length ? balancesAt(b, [then.toISOString().slice(0, 10)], linked) : new Map<string, number[]>();
  return goals.map((goal) => {
    const current = goal.account_id ? Math.max(0, accounts.get(goal.account_id) ?? 0) : goal.saved;
    const remaining = Math.max(0, goal.target - current);
    const reached = remaining === 0 || !!goal.done;
    const monthsLeft = goal.target_date ? monthsUntil(goal.target_date, day) : null;
    const overdue = !reached && !!goal.target_date && goal.target_date < day;
    const perMonth = !reached && monthsLeft !== null && monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : null;
    let pace: number | null = null;
    let eta: string | null = null;
    if (goal.account_id) {
      const before = past.get(goal.account_id)?.[0];
      if (before !== undefined) {
        pace = Math.round(((accounts.get(goal.account_id) ?? 0) - before) / PACE_MONTHS);
        if (!reached && pace > 0) eta = addMonths(day.slice(0, 7), Math.ceil(remaining / pace));
      }
    }
    return { goal, current, ratio: Math.min(1, current / goal.target), remaining, reached, monthsLeft, perMonth, overdue, pace, eta };
  });
}
