import Papa from 'papaparse';
import type { Book } from './core';
import type { Rule } from './types';
import { listAccounts, listRules, listSnapshots, saveAccount, saveRule, saveSnapshot, saveTransaction } from './repo';
import { findCategory } from './rules';
import { listContracts, type Contract } from './contracts';
import { parseAmount } from '../lib/money';

/**
 * Import von Kontoumsätzen aus CSV-Exporten deutscher Banken.
 * Getestet mit dem Export der Volksbanken/Raiffeisenbanken (Spalten „Buchungstag“, „Name Zahlungsbeteiligter“,
 * „Saldo nach Buchung“ …). Spaltennamen anderer Banken (Sparkasse, DKB, ING, comdirect) werden über Alias-Namen erkannt.
 */

export interface BankRow {
  line: number;
  date: string;
  amount: number;
  payee: string;
  /** Empfänger genau wie in der Datei (für den Fingerabdruck) */
  rawPayee: string;
  purpose: string;
  bookingText: string;
  /** Saldo nach der Buchung in Cent, falls die Bank ihn mitliefert */
  balance: number | null;
  hash: string;
}

export interface BankStatement {
  accountName: string | null;
  iban: string | null;
  bank: string | null;
  rows: BankRow[];
  from: string;
  to: string;
  /** Saldo am Ende des letzten Buchungstags */
  endBalance: number | null;
  /** Saldo vor der ersten Buchung */
  startBalance: number | null;
  /** Saldo am Ende jedes Buchungstags */
  dayEnd: Map<string, number>;
  warnings: string[];
}

const ALIASES: Record<string, string[]> = {
  date: ['buchungstag', 'buchungsdatum', 'buchung', 'datum'],
  valuta: ['valutadatum', 'valuta', 'wertstellung'],
  amount: ['betrag', 'betrag (eur)', 'betrag (€)', 'umsatz', 'umsatz in eur'],
  payee: ['name zahlungsbeteiligter', 'beguenstigter/zahlungspflichtiger', 'begünstigter/zahlungspflichtiger', 'zahlungsempfänger*in',
    'zahlungspflichtige*r', 'auftraggeber/empfänger', 'auftraggeber / begünstigter', 'empfänger', 'name'],
  purpose: ['verwendungszweck', 'buchungsdetails', 'vorgang/verwendungszweck'],
  bookingText: ['buchungstext', 'umsatzart', 'umsatztyp', 'vorgang'],
  balance: ['saldo nach buchung', 'saldo'],
  iban: ['iban auftragskonto', 'auftragskonto'],
  accountName: ['bezeichnung auftragskonto'],
  bank: ['bankname auftragskonto'],
  currency: ['waehrung', 'währung'],
};

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Entfernt SEPA-Kennungen (EREF, MREF, CRED …) aus dem Verwendungszweck. */
export function cleanPurpose(raw: string): string {
  const s = clean(raw);
  const cut = s.search(/\s(?:EREF|MREF|CRED|IBAN|BIC|ABWA|ABWE|KREF|SVWZ)[:+]/);
  const head = cut > 0 ? s.slice(0, cut) : s;
  return head.trim();
}

/** Bei PayPal, Klarna & Co. steht der eigentliche Händler im Verwendungszweck. */
function realPayee(payee: string, purpose: string): string {
  if (/^paypal/i.test(payee)) {
    const m = /Ihr Einkauf bei ([^,]+)/i.exec(purpose) ?? /^[^ ]*\/\. ([^,]+),/.exec(purpose);
    if (m) return `${m[1].trim()} (PayPal)`;
  }
  return payee;
}

function headerIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = lines[i].toLowerCase().split(/[;,\t]/).map((c) => c.replace(/"/g, '').trim());
    if (cells.some((c) => ALIASES.date.includes(c)) && cells.some((c) => ALIASES.amount.includes(c))) return i;
  }
  return -1;
}

export function parseBankCsv(text: string): BankStatement {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const h = headerIndex(lines);
  if (h < 0) throw new Error('In der Datei wurde keine Kopfzeile mit „Buchungstag“ und „Betrag“ gefunden. Ist das ein Umsatzexport der Bank?');
  const res = Papa.parse<Record<string, string>>(lines.slice(h).join('\n'), {
    header: true, skipEmptyLines: 'greedy', delimiter: '', transformHeader: (x) => x.trim().toLowerCase(),
  });
  const fields = res.meta.fields ?? [];
  const col = (key: string) => ALIASES[key].find((a) => fields.includes(a)) ?? null;
  const c = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)])) as Record<string, string | null>;
  const get = (row: Record<string, string>, key: string) => (c[key] ? row[c[key]!] ?? '' : '');

  const warnings: string[] = [];
  const parsed: Omit<BankRow, 'hash'>[] = [];
  let iban: string | null = null;
  let accountName: string | null = null;
  let bank: string | null = null;
  res.data.forEach((row, i) => {
    const date = toIsoDate(get(row, 'date'));
    const amount = parseAmount(get(row, 'amount'));
    if (!date || amount === null) {
      if (Object.values(row).some((v) => clean(v))) warnings.push(`Zeile ${h + i + 2} übersprungen (Datum oder Betrag unlesbar)`);
      return;
    }
    if (amount === 0) return;
    const cur = clean(get(row, 'currency'));
    if (cur && cur !== 'EUR') warnings.push(`Zeile ${h + i + 2}: Währung ${cur} wird als Euro übernommen`);
    iban ??= clean(get(row, 'iban')).replace(/\s/g, '') || null;
    accountName ??= clean(get(row, 'accountName')) || null;
    bank ??= clean(get(row, 'bank')) || null;
    const purpose = cleanPurpose(get(row, 'purpose'));
    const bookingText = clean(get(row, 'bookingText'));
    const rawPayee = clean(get(row, 'payee'));
    const bal = parseAmount(get(row, 'balance'));
    parsed.push({
      line: h + i + 2, date, amount, purpose, bookingText, rawPayee,
      payee: realPayee(rawPayee, purpose) || bank || bookingText || 'Unbekannt',
      balance: bal,
    });
  });
  if (!parsed.length) throw new Error('In der Datei wurden keine Buchungen gefunden.');

  // Reihenfolge erkennen: Banken liefern meist die neueste Buchung zuerst
  const newestFirst = parsed[0].date > parsed[parsed.length - 1].date
    || (parsed[0].date === parsed[parsed.length - 1].date && parsed.length > 1 && parsed[1].balance !== null && parsed[0].balance !== null
      && parsed[1].balance + parsed[0].amount === parsed[0].balance);
  const chrono = newestFirst ? [...parsed].reverse() : parsed;

  // Fingerabdruck: mit Saldo eindeutig, ohne Saldo über das wievielte gleiche Vorkommen
  const seen = new Map<string, number>();
  const rows: BankRow[] = chrono.map((r) => {
    const base = `bank:${iban ?? ''}|${r.date}|${r.amount}|${r.rawPayee}|${r.purpose}`;
    let hash: string;
    if (r.balance !== null) hash = `${base}|s${r.balance}`;
    else {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      hash = `${base}|#${n}`;
    }
    return { ...r, hash };
  });

  const dayEnd = new Map<string, number>();
  for (const r of rows) if (r.balance !== null) dayEnd.set(r.date, r.balance);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (rows.every((r) => r.balance !== null)) {
    let breaks = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].balance! + rows[i].amount !== rows[i].balance) breaks++;
    if (breaks) warnings.push(`Der Saldo passt an ${breaks} Stellen nicht zur Summe der Buchungen. Fehlen Buchungen in der Datei?`);
  }
  return {
    accountName, iban, bank, rows, warnings, dayEnd,
    from: first.date, to: last.date,
    endBalance: last.balance,
    startBalance: first.balance !== null ? first.balance - first.amount : null,
  };
}

/** Saldo am Ende eines Tages laut Bank (letzte Buchung an oder vor dem Tag). */
function bankBalanceOn(st: BankStatement, date: string): number | null {
  let v: number | null = st.startBalance;
  for (const [d, bal] of st.dayEnd) {
    if (d <= date) v = bal; else break;
  }
  return v;
}

/** Schlägt das passende Konto vor: gleiche IBAN, sonst ein Konto, dessen erfasster Kontostand zum Saldo der Bank passt. */
export function suggestAccount(b: Book, st: BankStatement): string | null {
  const accts = listAccounts(b, true);
  if (st.iban) {
    const hit = accts.find((a) => a.iban && a.iban.replace(/\s/g, '').toUpperCase() === st.iban!.toUpperCase());
    if (hit) return hit.id;
  }
  if (st.endBalance !== null) {
    const snaps = listSnapshots(b);
    const scores = new Map<string, number>();
    for (const s of snaps) {
      if (s.date < st.from || s.date > st.to) continue;
      if (bankBalanceOn(st, s.date) === s.balance) scores.set(s.account_id, (scores.get(s.account_id) ?? 0) + 1);
    }
    const best = [...scores.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best) return best[0];
  }
  if (st.bank) {
    const word = st.bank.split(/\s/)[0].toLowerCase();
    const cands = accts.filter((a) => !a.archived && a.type === 'checking' && (a.bank ?? '').toLowerCase().includes(word));
    if (cands.length === 1) return cands[0].id;
  }
  return null;
}

export type RowStatus = 'new' | 'duplicate' | 'possible';

export interface PlannedRow extends BankRow {
  status: RowStatus;
  categoryId: string | null;
  categorySource: 'rule' | 'contract' | null;
  contractId: string | null;
  contractName: string | null;
  /** bei möglicher Dublette: die vorhandene Buchung */
  match: { date: string; payee: string | null } | null;
}

export interface BankPlan {
  rows: PlannedRow[];
  newCount: number;
  duplicates: number;
  possible: number;
  categorized: number;
  contracts: number;
  /** vorhandene Kontostände im Zeitraum, die vom Saldo der Bank abweichen */
  snapshotFixes: { date: string; old: number; bank: number }[];
}

const STOP = new Set(['sparen', 'gebühr', 'gebuehr', 'beitrag', 'versicherung', 'mitgliedsbeitrag', 'konto', 'festnetz', 'handy']);
function contractWords(c: Contract): string[] {
  return `${c.name} ${c.payee ?? ''}`.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
}

function matchContract(contracts: Contract[], r: BankRow, accountId: string | null): Contract | null {
  const text = `${r.payee} ${r.purpose}`.toLowerCase();
  const hits = contracts.filter((c) => c.amount === r.amount && contractWords(c).some((w) => text.includes(w)));
  // Verträge mit passendem Abbuchungskonto zuerst; das Konto ist beim Vertrag oft nur grob gepflegt
  return hits.find((c) => c.account_id === accountId) ?? hits.find((c) => !c.account_id) ?? hits[0] ?? null;
}

/**
 * Prüft jede Zeile: schon importiert (gleicher Fingerabdruck), mögliche Dublette (gleicher Betrag ±3 Tage
 * bei einer von Hand oder anders erfassten Buchung), Kategorie über die Regeln, sonst über einen passenden Vertrag.
 */
export function planBankImport(b: Book, st: BankStatement, accountId: string | null, extraRules: Rule[] = []): BankPlan {
  const rules = listRules(b);
  const contracts = listContracts(b);
  const existing = accountId
    ? b.all<{ id: string; date: string; amount: number; payee: string | null; import_hash: string | null }>(
      'select id, date, amount, payee, import_hash from transactions where account_id = ? and date between date(?, \'-3 days\') and date(?, \'+3 days\')',
      [accountId, st.from, st.to])
    : [];
  const hashes = new Set(existing.map((t) => t.import_hash).filter(Boolean));
  const loose = existing.filter((t) => !t.import_hash?.startsWith('bank:'));
  const used = new Set<string>();
  const dayDiff = (a: string, z: string) => Math.abs(Date.parse(a) - Date.parse(z)) / 86400000;

  const rows: PlannedRow[] = st.rows.map((r) => {
    let status: RowStatus = 'new';
    let match: PlannedRow['match'] = null;
    if (hashes.has(r.hash)) status = 'duplicate';
    else {
      const m = loose.find((t) => !used.has(t.id) && t.amount === r.amount && dayDiff(t.date, r.date) <= 3);
      if (m) { used.add(m.id); status = 'possible'; match = { date: m.date, payee: m.payee }; }
    }
    const contract = matchContract(contracts, r, accountId);
    // Reihenfolge: eigene Regeln, dann Kategorie des Vertrags, dann Vorschlagsregeln
    const input = { payee: r.payee, purpose: `${r.purpose} ${r.bookingText}` };
    let categoryId = findCategory(rules, input);
    let categorySource: PlannedRow['categorySource'] = categoryId ? 'rule' : null;
    if (!categoryId && contract?.category_id) { categoryId = contract.category_id; categorySource = 'contract'; }
    if (!categoryId) { categoryId = findCategory(extraRules, input); categorySource = categoryId ? 'rule' : null; }
    return { ...r, status, match, categoryId, categorySource, contractId: contract?.id ?? null, contractName: contract?.name ?? null };
  });

  const snapshotFixes = accountId
    ? listSnapshots(b, accountId).filter((s) => s.date >= st.from && s.date <= st.to)
      .map((s) => ({ date: s.date, old: s.balance, bank: bankBalanceOn(st, s.date) }))
      .filter((s): s is { date: string; old: number; bank: number } => s.bank !== null && s.bank !== s.old)
    : [];
  const fresh = rows.filter((r) => r.status === 'new');
  return {
    rows, snapshotFixes,
    newCount: fresh.length,
    duplicates: rows.filter((r) => r.status === 'duplicate').length,
    possible: rows.filter((r) => r.status === 'possible').length,
    categorized: fresh.filter((r) => r.categoryId).length,
    contracts: fresh.filter((r) => r.contractId).length,
  };
}

export interface BankCommitOptions {
  /** vorhandenes Konto, oder null für ein neues Konto aus den Angaben der Datei */
  accountId: string | null;
  newAccount?: { name: string; owner?: string | null };
  includePossible?: boolean;
  /** Vorschlagsregeln, die mit angelegt werden sollen */
  extraRules?: Rule[];
}

export interface BankCommitResult {
  accountId: string;
  imported: number;
  snapshots: number;
  balance: number;
}

/** Übernimmt die Buchungen in einer Transaktion und gleicht die Kontostände mit dem Saldo der Bank ab. */
export function commitBankImport(b: Book, st: BankStatement, opts: BankCommitOptions): BankCommitResult {
  return b.tx(() => {
    let accountId = opts.accountId;
    if (!accountId) {
      accountId = saveAccount(b, {
        name: opts.newAccount?.name || st.accountName || 'Girokonto', type: 'checking', owner: opts.newAccount?.owner ?? null,
        bank: st.bank, iban: st.iban,
      });
    } else if (st.iban) {
      const a = listAccounts(b, true).find((x) => x.id === accountId);
      if (a && !a.iban) b.run('update accounts set iban = ? where id = ?', [st.iban, accountId]);
    }
    const plan = planBankImport(b, st, accountId, opts.extraRules);
    let imported = 0;
    for (const r of plan.rows) {
      if (r.status === 'duplicate' || (r.status === 'possible' && !opts.includePossible)) continue;
      saveTransaction(b, {
        account_id: accountId, date: r.date, amount: r.amount, payee: r.payee, purpose: r.purpose || null,
        category_id: r.categoryId, autoCategorize: false, import_hash: r.hash, recurring_id: r.contractId,
      });
      imported++;
    }
    // Vorschlagsregeln erst nach der Planung speichern, damit Vertragskategorien Vorrang behalten
    for (const r of opts.extraRules ?? []) saveRule(b, { field: r.field, op: r.op, value: r.value, category_id: r.category_id, priority: r.priority });
    let snapshots = 0;
    if (st.endBalance !== null) {
      for (const f of plan.snapshotFixes) { saveSnapshot(b, accountId, f.date, f.bank, 'an Kontoauszug angeglichen'); snapshots++; }
      saveSnapshot(b, accountId, st.to, st.endBalance, 'laut Kontoauszug');
      snapshots++;
      if (st.startBalance !== null) {
        const d = new Date(`${st.from}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        saveSnapshot(b, accountId, d.toISOString().slice(0, 10), st.startBalance, 'laut Kontoauszug (vor der ersten Buchung)');
        snapshots++;
      }
    }
    const balance = listAccounts(b, true).find((a) => a.id === accountId)!.balance;
    return { accountId, imported, snapshots, balance };
  });
}
