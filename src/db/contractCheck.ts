import type { Book } from './core';
import { listContracts, saveContract, perYear, type Contract, type Interval } from './contracts';
import { payeeKey, samePayee, close } from './plannedTx';
import { uid, now as nowIso } from '../lib/id';
import { today } from '../lib/dates';

/**
 * Vertrags-Check: was eine Vertrags-App im Hintergrund prüft, hier lokal aus den eigenen Buchungen.
 * - Erkennung: regelmäßige Abbuchungen, zu denen es noch keinen Vertrag gibt
 * - Preisänderungen: letzte Zahlung eines Vertrags weicht von der vorherigen ab
 * - Kündigungsfristen: wann ein Vertrag spätestens gekündigt werden muss
 * - Versicherungs-Check: welche üblichen Versicherungen vorhanden sind
 */

const DAY = 86400000;
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const fromMs = (n: number) => new Date(n).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

/** Datum + n Monate, Tag wird auf das Monatsende begrenzt (31.01. + 1 = 28.02.) */
export function addMonthsToDate(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const STEP: Record<Interval, number> = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };

/* ===================== Erkennung ===================== */

export interface ContractSuggestion {
  key: string;
  payee: string;
  amount: number;
  interval: Interval;
  lastDate: string;
  count: number;
  category_id: string | null;
  category_name: string | null;
  account_id: string;
  account_name: string;
  txIds: string[];
}

interface Tx {
  id: string; date: string; amount: number; payee: string | null; category_id: string | null; category_name: string | null;
  account_id: string; account_name: string; recurring_id: string | null;
}

function intervalOf(gaps: number[], n: number): Interval | null {
  if (n >= 3 && gaps.every((g) => g >= 25 && g <= 36)) return 'monthly';
  if (n >= 2 && gaps.every((g) => g >= 80 && g <= 100)) return 'quarterly';
  if (n >= 2 && gaps.every((g) => g >= 170 && g <= 200)) return 'halfyearly';
  if (n >= 2 && gaps.every((g) => g >= 350 && g <= 380)) return 'yearly';
  return null;
}

/** Regelmäßige Ausgaben (gleiche Gegenseite, etwa gleicher Betrag, fester Rhythmus) ohne passenden Vertrag. */
export function detectContracts(b: Book, now = today()): ContractSuggestion[] {
  const txs = b.all<Tx>(
    `select t.id, t.date, t.amount, t.payee, t.category_id, c.name as category_name, t.account_id, a.name as account_name, t.recurring_id
     from transactions t join accounts a on a.id = t.account_id left join categories c on c.id = t.category_id
     where t.transfer_id is null and t.amount < 0 and a.external = 0 and a.type <> 'depot' and t.date >= ? and t.date <= ?
     order by t.date`,
    [addDays(now, -800), now],
  );
  // alle Verträge zählen, auch beendete und abgelehnte Vorschläge: die sollen nicht wiederkommen
  const known = b.all<{ id: string; payee: string | null; name: string | null; amount: number; category_id: string | null; interval: Interval }>(
    'select id, payee, name, amount, category_id, interval from recurring',
  ).map((c) => ({ ...c, key: payeeKey(c.payee || c.name) }));
  /** Gibt es schon einen Vertrag dafür? Gleiche Gegenseite (einzeln oder mehrere Verträge zusammen abgebucht)
   *  oder gleiche Kategorie mit fast gleichem Betrag (Vertrag heißt anders als die Lastschrift, z. B. „Strom“ ↔ EnBW). */
  const covered = (key: string, amount: number, category: string | null, interval: Interval) => {
    const same = known.filter((c) => samePayee(c.key, key));
    if (same.some((c) => close(amount, c.amount, 0.25))) return true;
    const sum = same.filter((c) => c.interval === interval).reduce((a, c) => a + c.amount, 0);
    if (same.length > 1 && close(amount, sum, 0.1)) return true;
    return !!category && known.some((c) => c.category_id === category && close(amount, c.amount, 0.15));
  };
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    const k = payeeKey(t.payee);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const out: ContractSuggestion[] = [];
  for (const [key, all] of groups) {
    if (all.some((t) => t.recurring_id)) continue;
    // viele unregelmäßige Buchungen an dieselbe Stelle (Supermarkt, Tankstelle): kein Vertrag
    const months = new Set(all.map((t) => t.date.slice(0, 7))).size;
    if (all.length > months * 1.5) continue;
    const clusters: Tx[][] = [];
    for (const t of [...all].reverse()) {
      const cl = clusters.find((c) => close(t.amount, median(c.map((x) => x.amount)), 0.1));
      if (cl) cl.push(t); else clusters.push([t]);
    }
    for (const cl0 of clusters) {
      const cl = [...cl0].sort((a, b) => a.date.localeCompare(b.date));
      const last = cl[cl.length - 1];
      const recent = cl.slice(-4);
      const gaps = recent.slice(1).map((t, i) => daysBetween(recent[i].date, t.date));
      const interval = intervalOf(gaps, recent.length);
      if (!interval) continue;
      // seltene Zahlungen an eine Stelle, an die sonst oft und unterschiedlich gezahlt wird (Amazon, Ladestrom): Zufall
      if (interval !== 'monthly' && all.length > cl.length * 3) continue;
      // abgerissene Reihe: letzte Zahlung länger als ein Rhythmus plus Puffer her
      if (daysBetween(last.date, now) > STEP[interval] * 31 + 20) continue;
      if (covered(key, last.amount, last.category_id, interval)) continue;
      out.push({
        key: `${key}|${interval}|${last.amount}`, payee: last.payee ?? key, amount: last.amount, interval, lastDate: last.date, count: cl.length,
        category_id: last.category_id, category_name: last.category_name, account_id: last.account_id, account_name: last.account_name,
        txIds: cl.map((t) => t.id),
      });
    }
  }
  return out.sort((a, b) => perYear(a) - perYear(b));
}

/** Vorschlag als Vertrag übernehmen; die erkannten Buchungen werden mit ihm verknüpft. */
export function acceptSuggestion(b: Book, s: ContractSuggestion, name?: string): string {
  return b.tx(() => {
    const id = saveContract(b, {
      name: (name ?? s.payee).trim() || s.payee, category_id: s.category_id, account_id: s.account_id, amount: s.amount, interval: s.interval,
      due_day: Number(s.lastDate.slice(8, 10)), due_months: s.interval === 'monthly' ? null : [Number(s.lastDate.slice(5, 7))],
      start_date: null, kind: 'Abo',
    });
    for (const t of s.txIds) b.run('update transactions set recurring_id = ? where id = ? and recurring_id is null', [id, t]);
    return id;
  });
}

/** Vorschlag ablehnen: wird als abgelehnter Eintrag gemerkt und nicht wieder vorgeschlagen. */
export function dismissSuggestion(b: Book, s: ContractSuggestion) {
  const t = nowIso();
  b.run(
    `insert into recurring (id, payee, name, account_id, amount, interval, status, created_at, updated_at) values (?,?,?,?,?,?, 'dismissed', ?, ?)`,
    [uid(), s.payee, s.payee, s.account_id, s.amount, s.interval, t, t],
  );
}

/* ===================== Preisänderungen ===================== */

export interface PriceChange {
  contract: Contract;
  previous: number;
  current: number;
  previousDate: string;
  date: string;
  /** Mehr- (negativ) oder Minderkosten (positiv) pro Jahr */
  perYear: number;
  /** Betrag im Vertrag weicht von der letzten Zahlung ab */
  contractOutdated: boolean;
}

interface PayTx { id: string; date: string; amount: number; payee: string | null; recurring_id: string | null }

/** Zahlungen je Vertrag: verknüpfte Buchungen, sonst gleiche Gegenseite mit ähnlichem Betrag (bei mehreren Verträgen derselben Gegenseite der nächstliegende). */
export function contractPayments(b: Book, contracts: Contract[], now = today()): Map<string, PayTx[]> {
  const txs = b.all<PayTx>(
    `select t.id, t.date, t.amount, t.payee, t.recurring_id from transactions t join accounts a on a.id = t.account_id
     where t.transfer_id is null and a.external = 0 and t.date >= ? and t.date <= ? order by t.date`,
    [addDays(now, -800), now],
  );
  const out = new Map<string, PayTx[]>(contracts.map((c) => [c.id, []]));
  const byId = new Set(contracts.map((c) => c.id));
  const linkedContracts = new Set(txs.filter((t) => t.recurring_id && byId.has(t.recurring_id)).map((t) => t.recurring_id!));
  const keys = contracts.map((c) => ({ c, key: payeeKey(c.payee || c.name) }));
  for (const t of txs) {
    if (t.recurring_id && byId.has(t.recurring_id)) { out.get(t.recurring_id)!.push(t); continue; }
    if (t.recurring_id) continue;
    const k = payeeKey(t.payee);
    let best: Contract | null = null;
    for (const { c, key } of keys) {
      if (linkedContracts.has(c.id) || Math.sign(c.amount) !== Math.sign(t.amount)) continue;
      if (!samePayee(key, k) || !close(t.amount, c.amount, 0.3)) continue;
      if (!best || Math.abs(t.amount - c.amount) < Math.abs(t.amount - best.amount)) best = c;
    }
    if (best) out.get(best.id)!.push(t);
  }
  return out;
}

/** Verträge, deren letzte Zahlung (in den letzten `days` Tagen) anders ausfiel als die vorherige. */
export function priceChanges(b: Book, now = today(), days = 180): PriceChange[] {
  const contracts = listContracts(b).filter((c) => c.amount < 0);
  const pays = contractPayments(b, contracts, now);
  const out: PriceChange[] = [];
  for (const c of contracts) {
    const p = pays.get(c.id) ?? [];
    if (p.length < 2) continue;
    const last = p[p.length - 1];
    const prev = p[p.length - 2];
    if (daysBetween(last.date, now) > days) continue;
    // gleicher Tag: zwei Teilbuchungen, keine Preisänderung
    if (last.date === prev.date) continue;
    const diff = last.amount - prev.amount;
    if (Math.abs(diff) < Math.max(50, Math.abs(prev.amount) * 0.02)) continue;
    out.push({
      contract: c, previous: prev.amount, current: last.amount, previousDate: prev.date, date: last.date,
      perYear: diff * (12 / STEP[c.interval]), contractOutdated: last.amount !== c.amount,
    });
  }
  return out.sort((a, b) => a.perYear - b.perYear);
}

/** Betrag des Vertrags auf die letzte Zahlung setzen. */
export function updateContractAmount(b: Book, id: string, amount: number) {
  b.run('update recurring set amount = ?, updated_at = ? where id = ?', [amount, nowIso(), id]);
}

/* ===================== Kündigungsfristen ===================== */

export interface Notice { anytime: boolean; months: number; days: number; monthEnd: boolean }

/** Liest Kündigungsfristen wie „3 Monate“, „1 Monat zum Monatsende“, „4 Wochen“, „14 Tage“, „sofort“. */
export function parseNotice(s: string | null | undefined): Notice | null {
  const t = (s ?? '').toLowerCase().trim();
  if (!t || t === '-') return null;
  const monthEnd = /monatsende|ende des (kalender)?monats|zum ende/.test(t);
  if (/sofort|jederzeit|täglich|keine/.test(t)) return { anytime: true, months: 0, days: 0, monthEnd: false };
  const n = /(\d+)\s*(monat|mon\b|m\b|woche|wo\b|tag|t\b|jahr)/.exec(t);
  if (!n) return null;
  const v = Number(n[1]);
  const u = n[2];
  if (u.startsWith('w')) return { anytime: false, months: 0, days: v * 7, monthEnd };
  if (u.startsWith('t')) return { anytime: false, months: 0, days: v, monthEnd };
  if (u.startsWith('j')) return { anytime: false, months: v * 12, days: 0, monthEnd };
  return { anytime: false, months: v, days: 0, monthEnd };
}

export interface Cancellation {
  contract: Contract;
  /** jederzeit kündbar */
  anytime: boolean;
  /** letzter Tag der laufenden (bzw. nächsten erreichbaren) Laufzeit */
  termEnd: string | null;
  /** spätester Tag für den Eingang der Kündigung */
  deadline: string | null;
  daysLeft: number | null;
  /** Grund, warum nichts berechnet werden konnte */
  missing: string | null;
}

const monthEndOf = (d: string) => { const [y, m] = d.split('-').map(Number); return fromMs(Date.UTC(y, m, 0)); };

/** Kündigungstermin: Laufzeit ab Vertragsbeginn in Schritten von `term_months` (sonst Zahlungsrhythmus), minus Kündigungsfrist. */
export function cancellation(c: Contract, now = today()): Cancellation {
  const base = { contract: c, anytime: false, termEnd: null, deadline: null, daysLeft: null };
  const notice = parseNotice(c.notice_period);
  if (!notice) return { ...base, missing: 'Kündigungsfrist fehlt' };
  if (notice.anytime) return { ...base, anytime: true, missing: null };
  if (!c.start_date) return { ...base, missing: 'Vertragsbeginn fehlt' };
  const term = c.term_months ?? STEP[c.interval];
  for (let k = 1; k <= 1200; k++) {
    let end = addDays(addMonthsToDate(c.start_date, k * term), -1);
    if (notice.monthEnd) end = monthEndOf(end);
    // Kündigung muss vor Laufzeitende eingehen: 31.12. mit 3 Monaten → 30.09., mit 14 Tagen → 17.12.
    const deadline = notice.months ? addDays(addMonthsToDate(addDays(end, 1), -notice.months), -1) : addDays(end, -notice.days);
    if (deadline >= now) return { ...base, termEnd: end, deadline, daysLeft: daysBetween(now, deadline), missing: null };
  }
  return { ...base, missing: 'Vertragsbeginn fehlt' };
}

/** Kündigungsfristen, die in den nächsten `days` Tagen ablaufen. */
export function upcomingDeadlines(b: Book, days = 60, now = today()): Cancellation[] {
  return listContracts(b)
    .filter((c) => !c.end_date) // schon gekündigt oder befristet
    .map((c) => cancellation(c, now))
    .filter((x) => x.deadline && x.daysLeft != null && x.daysLeft <= days)
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!));
}

/* ===================== Kündigungsschreiben ===================== */

export interface Sender { name: string; street: string; city: string }

export function loadSender(b: Book): Sender {
  try { return { name: '', street: '', city: '', ...JSON.parse(b.meta('letter_sender') ?? '{}') }; } catch { return { name: '', street: '', city: '' }; }
}
export function saveSender(b: Book, s: Sender) {
  b.setMeta('letter_sender', JSON.stringify(s));
}

export type LetterMode = 'regular' | 'date' | 'special';

export interface LetterInput {
  sender: Sender;
  recipient: string;
  contractName: string;
  purpose?: string | null;
  customerNo?: string | null;
  mode: LetterMode;
  /** Kündigungsdatum bei mode 'date' bzw. berechnetes Laufzeitende */
  date?: string | null;
  /** Grund bei Sonderkündigung, z. B. Preiserhöhung */
  reason?: string | null;
  place?: string;
  today?: string;
}

const de = (d: string) => d.split('-').reverse().join('.');

/** Kündigungsschreiben als Text (Absender, Empfänger, Betreff, Text, Gruß). */
export function cancellationLetter(i: LetterInput): string {
  const t = i.today ?? today();
  const subject = `Kündigung ${i.contractName}${i.purpose ? ` (${i.purpose})` : ''}${i.customerNo ? `, Kunden-/Vertragsnummer ${i.customerNo}` : ''}`;
  const body =
    i.mode === 'special'
      ? `hiermit kündige ich den oben genannten Vertrag außerordentlich mit sofortiger Wirkung${i.reason ? `. Grund: ${i.reason}` : ''}. ` +
        'Ich mache damit von meinem Sonderkündigungsrecht Gebrauch. Hilfsweise kündige ich fristgerecht zum nächstmöglichen Zeitpunkt.'
      : i.mode === 'date' && i.date
        ? `hiermit kündige ich den oben genannten Vertrag fristgerecht zum ${de(i.date)}. Sollte dieser Termin nicht möglich sein, kündige ich zum nächstmöglichen Zeitpunkt.`
        : 'hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.';
  const city = i.place ?? i.sender.city.replace(/^\d{5}\s*/, '');
  return [
    [i.sender.name, i.sender.street, i.sender.city].filter(Boolean).join('\n'),
    '',
    i.recipient.trim(),
    '',
    `${city ? city + ', ' : ''}${de(t)}`,
    '',
    subject,
    '',
    'Sehr geehrte Damen und Herren,',
    '',
    body,
    '',
    'Bitte bestätigen Sie mir den Eingang der Kündigung und das Vertragsende schriftlich. Eine erteilte Einzugsermächtigung bzw. ein SEPA-Lastschriftmandat widerrufe ich zum Vertragsende.',
    '',
    'Mit freundlichen Grüßen',
    '',
    '',
    i.sender.name,
  ].join('\n');
}

/** Vertrag als gekündigt vermerken: Ende setzen, Notiz ergänzen. */
export function markCancelled(b: Book, c: Contract, endDate: string | null, sentOn = today()) {
  const note = [c.note, `gekündigt am ${de(sentOn)}`].filter(Boolean).join(' · ');
  b.run('update recurring set end_date = ?, note = ?, updated_at = ? where id = ?', [endDate, note, nowIso(), c.id]);
}

/* ===================== Versicherungs-Check ===================== */

export interface InsuranceType { id: string; label: string; words: string[]; not?: string[]; hint: string }

export const INSURANCE_TYPES: InsuranceType[] = [
  { id: 'haftpflicht', label: 'Privathaftpflicht', words: ['haftpflicht', 'phv'], not: ['kfz', 'auto', 'tier', 'hund', 'pferd'], hint: 'Gilt als wichtigste Versicherung für jeden Haushalt.' },
  { id: 'kranken', label: 'Kranken- und Zusatzversicherung', words: ['kranken', 'zahn', 'pkv'], not: ['reise'], hint: 'Gesetzliche Kasse läuft meist über die Gehaltsabrechnung, Zusätze sind freiwillig.' },
  { id: 'bu', label: 'Berufsunfähigkeit', words: ['berufsunf', 'bu', 'dienstunf'], hint: 'Wichtig für alle, die vom eigenen Einkommen leben.' },
  { id: 'leben', label: 'Risikolebensversicherung', words: ['risikoleben', 'risiko-leben', 'todesfall'], hint: 'Sinnvoll, wenn andere vom Einkommen abhängen oder ein Kredit läuft.' },
  { id: 'hausrat', label: 'Hausrat', words: ['hausrat'], hint: 'Deckt Einbruch, Feuer und Leitungswasser am Inventar.' },
  { id: 'gebaeude', label: 'Wohngebäude', words: ['wohngebäude', 'gebäude', 'elementar'], hint: 'Für Haus- oder Wohnungseigentümer unverzichtbar.' },
  { id: 'kfz', label: 'Kfz-Versicherung', words: ['kfz', 'auto', 'pkw', 'kasko'], hint: 'Haftpflicht ist für jedes Auto Pflicht.' },
  { id: 'rechtsschutz', label: 'Rechtsschutz', words: ['rechtsschutz'], hint: 'Freiwillig, je nach Bedarf (Beruf, Verkehr, Miete).' },
  { id: 'unfall', label: 'Unfall', words: ['unfall'], not: ['kfz'], hint: 'Freiwillig, ergänzt eine fehlende Berufsunfähigkeit nur teilweise.' },
  { id: 'reise', label: 'Reiseversicherung', words: ['reise', 'auslandskranken'], hint: 'Auslandsreisekranken ist günstig und bei Reisen außerhalb der EU wichtig.' },
  { id: 'tier', label: 'Tierhalterhaftpflicht', words: ['tierhalter', 'hundehaftpflicht', 'tier', 'hund', 'pferd'], hint: 'Für Hunde- und Pferdehalter, in einigen Ländern Pflicht.' },
];

export interface InsuranceCheckRow { type: InsuranceType; contracts: Contract[]; perYear: number }

function textOf(c: Contract): string {
  return ` ${[c.name, c.purpose, c.kind, c.category_name, c.note].filter(Boolean).join(' ').toLowerCase()} `;
}

function matches(text: string, t: InsuranceType): boolean {
  const hit = t.words.some((w) => (w.length <= 3 ? new RegExp(`[^a-zäöü]${w}[^a-zäöü]`).test(text) : text.includes(w)));
  return hit && !(t.not ?? []).some((w) => text.includes(w));
}

/** Welche üblichen Versicherungen unter den aktiven Verträgen vorkommen. */
export function insuranceCheck(b: Book): InsuranceCheckRow[] {
  const ins = listContracts(b).filter((c) => /versich|police|haftpflicht|schutz/.test(textOf(c)) || c.kind?.toLowerCase().startsWith('versich'));
  return INSURANCE_TYPES.map((type) => {
    const contracts = ins.filter((c) => matches(textOf(c), type));
    return { type, contracts, perYear: contracts.reduce((a, c) => a + perYear(c), 0) };
  });
}
