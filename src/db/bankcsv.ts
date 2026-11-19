import Papa from 'papaparse';
import type { Book } from './core';
import type { Rule } from './types';
import { listAccounts, listRules, listSnapshots, saveAccount, saveRule, saveSnapshot, saveTransaction } from './repo';
import { findCategory } from './rules';
import { listContracts, type Contract } from './contracts';
import { parseAmount } from '../lib/money';
import { uid } from '../lib/id';

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
  /** IBAN der Gegenseite, falls bekannt */
  counterIban: string | null;
  /** Wertpapierkauf oder -verkauf (gehört zum Depot) */
  securities: boolean;
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
  counterIban: ['iban zahlungsbeteiligter', 'iban', 'kontonummer/iban'],
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

/**
 * comdirect packt Empfänger, IBAN und Text in eine Spalte:
 * „Auftraggeber: X Buchungstext: Y Ref. Z“ oder „Empfänger: XKto/IBAN: DE… BLZ/BIC: … Buchungstext: Y Ref. Z“.
 */
export function parseComdirectText(raw: string): { payee: string; purpose: string; counterIban: string | null; ref: string | null } {
  const s = clean(raw);
  const counterIban = /Kto\/IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{8,30})/.exec(s)?.[1] ?? null;
  const ref = /Ref\.\s*(\S+)/.exec(s)?.[1] ?? null;
  let payee = /^(?:Auftraggeber|Empfänger):\s*(.*?)\s*(?=Kto\/IBAN:|Buchungstext:|Ref\.|$)/.exec(s)?.[1] ?? '';
  let purpose = /Buchungstext:\s*(.*?)\s*(?=Ref\.|$)/.exec(s)?.[1] ?? '';
  purpose = purpose.replace(/\s*Karte Nr\..*$/, '').trim();
  if (!payee) payee = purpose.split(',')[0].trim();
  return { payee, purpose, counterIban, ref };
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
  // comdirect: „Vorgang“ ist die Buchungsart, „Buchungstext“ enthält Empfänger und Zweck; Salden stehen im Kopf und Fuß
  const comdirect = fields.includes('vorgang') && fields.includes('buchungstext') && !c.purpose && !c.payee;
  const outside = [...lines.slice(0, h), ...lines.slice(h).filter((l) => /kontostand/i.test(l))].join('\n');
  const headBal = (label: string) => {
    const m = new RegExp(`${label}"?;"?([-+]?[\\d.,]+)\\s*EUR`, 'i').exec(outside);
    return m ? parseAmount(m[1]) : null;
  };
  if (comdirect) { c.bookingText = 'vorgang'; c.purpose = 'buchungstext'; }
  const get = (row: Record<string, string>, key: string) => (c[key] ? row[c[key]!] ?? '' : '');

  const warnings: string[] = [];
  const parsed: Omit<BankRow, 'hash'>[] = [];
  let iban: string | null = null;
  let accountName: string | null = null;
  let bank: string | null = null;
  let pending = 0;
  const refs = new Map<number, string>();
  res.data.forEach((row, i) => {
    const date = toIsoDate(get(row, 'date'));
    const amount = parseAmount(get(row, 'amount'));
    if (!date || amount === null) {
      const filled = Object.values(row).filter((v) => clean(v)).length;
      if (/^offen$/i.test(clean(get(row, 'date')))) pending++;
      else if (filled > 2 && !Object.values(row).some((v) => /kontostand/i.test(v ?? ''))) warnings.push(`Zeile ${h + i + 2} übersprungen (Datum oder Betrag unlesbar)`);
      return;
    }
    if (amount === 0) return;
    const cur = clean(get(row, 'currency'));
    if (cur && cur !== 'EUR') warnings.push(`Zeile ${h + i + 2}: Währung ${cur} wird als Euro übernommen`);
    iban ??= clean(get(row, 'iban')).replace(/\s/g, '') || null;
    accountName ??= clean(get(row, 'accountName')) || null;
    bank ??= clean(get(row, 'bank')) || null;
    const bookingText = clean(get(row, 'bookingText'));
    let purpose = cleanPurpose(get(row, 'purpose'));
    let rawPayee = clean(get(row, 'payee'));
    let counterIban = clean(get(row, 'counterIban')).replace(/\s/g, '') || null;
    if (comdirect) {
      const x = parseComdirectText(get(row, 'purpose'));
      purpose = x.purpose; rawPayee = x.payee; counterIban = x.counterIban;
      if (x.ref) refs.set(parsed.length, x.ref);
    }
    const bal = parseAmount(get(row, 'balance'));
    parsed.push({
      line: h + i + 2, date, amount, purpose, bookingText, rawPayee, counterIban,
      securities: /^wertpapier/i.test(bookingText),
      payee: (realPayee(rawPayee, purpose) || bank || bookingText || 'Unbekannt').split(/\s+(?:WPKNR:|ISIN:|DEPOTBESTAND:)/)[0],
      balance: bal,
    });
  });
  if (!parsed.length) throw new Error('In der Datei wurden keine Buchungen gefunden.');
  if (pending) warnings.push(`${pending} vorgemerkte, noch nicht gebuchte Umsätze werden nicht übernommen`);
  if (comdirect) {
    bank ??= 'comdirect';
    accountName ??= /Umsätze ([^";]+)/.exec(lines.slice(0, h).join(' '))?.[1]?.trim() ?? null;
  }

  // Reihenfolge erkennen: Banken liefern meist die neueste Buchung zuerst
  const newestFirst = parsed[0].date > parsed[parsed.length - 1].date
    || (parsed[0].date === parsed[parsed.length - 1].date && parsed.length > 1 && parsed[1].balance !== null && parsed[0].balance !== null
      && parsed[1].balance + parsed[0].amount === parsed[0].balance);
  const withRef = parsed.map((r, i) => ({ ...r, ref: refs.get(i) ?? null }));
  const chrono = newestFirst ? [...withRef].reverse() : withRef;

  // Fingerabdruck: mit Saldo eindeutig, ohne Saldo über das wievielte gleiche Vorkommen
  const seen = new Map<string, number>();
  const rows: BankRow[] = chrono.map(({ ref, ...r }) => {
    const base = `bank:${iban ?? ''}|${r.date}|${r.amount}|${r.rawPayee}|${r.purpose}`;
    let hash: string;
    if (ref) hash = `bank:${iban ?? bank ?? ''}|ref:${ref}|${r.amount}`;
    else if (r.balance !== null) hash = `${base}|s${r.balance}`;
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
  let endBalance = last.balance;
  let startBalance = first.balance !== null ? first.balance - first.amount : null;
  if (endBalance === null && startBalance === null) {
    // Salden aus Kopf- und Fußzeilen (comdirect: „Alter Kontostand“, „Neuer Kontostand“)
    const oldB = headBal('Alter Kontostand');
    const newB = headBal('Neuer Kontostand');
    const sum = rows.reduce((a, r) => a + r.amount, 0);
    startBalance = oldB ?? (newB !== null ? newB - sum : null);
    endBalance = newB ?? (oldB !== null ? oldB + sum : null);
    if (oldB !== null && newB !== null && oldB + sum !== newB) {
      warnings.push(`Alter Kontostand plus Buchungen ergibt ${(oldB + sum) / 100} €, die Bank meldet ${newB / 100} €. Fehlen Buchungen in der Datei?`);
    } else if (startBalance !== null) {
      let run = startBalance;
      for (const r of rows) { run += r.amount; dayEnd.set(r.date, run); }
    }
  }
  return {
    accountName, iban, bank, rows, warnings, dayEnd,
    from: first.date, to: last.date, endBalance, startBalance,
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
  /** wird als Umbuchung erfasst: mit einer vorhandenen Gegenbuchung (txId) oder mit einer neuen im Depot */
  transfer: { accountId: string; accountName: string; txId: string | null; date: string } | null;
}

export interface BankPlan {
  rows: PlannedRow[];
  newCount: number;
  duplicates: number;
  possible: number;
  categorized: number;
  contracts: number;
  /** Überweisungen zwischen eigenen Konten, mit vorhandener Gegenbuchung verknüpft */
  transfers: number;
  /** Wertpapierkäufe und -verkäufe, als Umbuchung zum Depot */
  depot: number;
  depotName: string | null;
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
  // eigene Konten für Umbuchungen
  const accts = listAccounts(b, true);
  const target = accts.find((a) => a.id === accountId) ?? null;
  const byIban = new Map(accts.filter((a) => a.iban && a.id !== accountId).map((a) => [a.iban!.replace(/\s/g, '').toUpperCase(), a]));
  const norm = (x: string | null | undefined) => (x ?? '').toLowerCase().trim();
  const depots = target ? accts.filter((a) => a.type === 'depot' && a.id !== accountId && norm(a.owner) === norm(target.owner)
    && target.bank && norm(a.bank).includes(norm(target.bank).split(/\s/)[0])) : [];
  const depot = depots.length === 1 ? depots[0] : depots.find((a) => !a.archived) ?? null;
  const counter = accountId
    ? b.all<{ id: string; account_id: string; date: string; amount: number; payee: string | null; purpose: string | null }>(
      `select id, account_id, date, amount, payee, purpose from transactions
       where account_id <> ? and transfer_id is null and date between date(?, '-4 days') and date(?, '+4 days')`, [accountId, st.from, st.to])
    : [];
  const usedCounter = new Set<string>();
  const INTERNAL = /umbuchung|übertrag|uebertrag|kontoübertrag|eigenes konto/i;
  const words = (x: string | null) => new Set(norm(x).split(/[^a-zäöüß]+/).filter((w) => w.length >= 4 && !['gmbh', 'bank', 'konto'].includes(w)));
  // Die Gegenbuchung muss selbst nach Umbuchung aussehen oder denselben Namen tragen (nicht etwa eine Barabhebung mit gleichem Betrag)
  const plausible = (t: { payee: string | null; purpose: string | null }, r: BankRow) => {
    if (INTERNAL.test(`${t.payee ?? ''} ${t.purpose ?? ''}`)) return true;
    const w = words(r.payee);
    return [...words(t.payee)].some((x) => w.has(x));
  };
  const dayDiff = (a: string, z: string) => Math.abs(Date.parse(a) - Date.parse(z)) / 86400000;

  const rows: PlannedRow[] = st.rows.map((r) => {
    let status: RowStatus = 'new';
    let match: PlannedRow['match'] = null;
    if (hashes.has(r.hash)) status = 'duplicate';
    else {
      const m = loose.find((t) => !used.has(t.id) && t.amount === r.amount && dayDiff(t.date, r.date) <= 3);
      if (m) { used.add(m.id); status = 'possible'; match = { date: m.date, payee: m.payee }; }
    }
    let transfer: PlannedRow['transfer'] = null;
    if (status === 'new' && accountId) {
      const own = r.counterIban ? byIban.get(r.counterIban.toUpperCase()) : undefined;
      if (r.securities && depot) {
        transfer = { accountId: depot.id, accountName: depot.name, txId: null, date: r.date };
      } else if (own || INTERNAL.test(`${r.bookingText} ${r.purpose}`)) {
        const m = counter
          .filter((t) => !usedCounter.has(t.id) && t.amount === -r.amount && dayDiff(t.date, r.date) <= 4 && (!own || t.account_id === own.id) && plausible(t, r))
          .sort((x, y) => dayDiff(x.date, r.date) - dayDiff(y.date, r.date)
            || Number(norm(accts.find((a) => a.id === y.account_id)?.owner) === norm(target?.owner)) - Number(norm(accts.find((a) => a.id === x.account_id)?.owner) === norm(target?.owner)))[0];
        if (m) {
          usedCounter.add(m.id);
          const a = accts.find((x) => x.id === m.account_id)!;
          transfer = { accountId: a.id, accountName: a.name, txId: m.id, date: m.date };
        }
      }
    }
    const contract = transfer ? null : matchContract(contracts, r, accountId);
    // Reihenfolge: eigene Regeln, dann Kategorie des Vertrags, dann Vorschlagsregeln
    const input = { payee: r.payee, purpose: `${r.purpose} ${r.bookingText}` };
    let categoryId = findCategory(rules, input);
    let categorySource: PlannedRow['categorySource'] = categoryId ? 'rule' : null;
    if (!categoryId && contract?.category_id) { categoryId = contract.category_id; categorySource = 'contract'; }
    if (!categoryId) { categoryId = findCategory(extraRules, input); categorySource = categoryId ? 'rule' : null; }
    if (transfer) { categoryId = null; categorySource = null; }
    return { ...r, status, match, transfer, categoryId, categorySource, contractId: contract?.id ?? null, contractName: contract?.name ?? null };
  });

  const snapshotFixes = accountId && st.dayEnd.size
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
    transfers: fresh.filter((r) => r.transfer?.txId).length,
    depot: fresh.filter((r) => r.transfer && !r.transfer.txId).length,
    depotName: depot ? `${depot.name}${depot.owner ? ` · ${depot.owner}` : ''}` : null,
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
  transfers: number;
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
    let transfers = 0;
    for (const r of plan.rows) {
      if (r.status === 'duplicate' || (r.status === 'possible' && !opts.includePossible)) continue;
      const id = saveTransaction(b, {
        account_id: accountId, date: r.date, amount: r.amount, payee: r.payee, purpose: r.purpose || null,
        category_id: r.categoryId, autoCategorize: false, import_hash: r.hash, recurring_id: r.contractId,
      });
      if (r.transfer) {
        const t = uid();
        b.run('update transactions set transfer_id = ?, category_id = null where id = ?', [t, id]);
        if (r.transfer.txId) {
          b.run('update transactions set transfer_id = ?, category_id = null where id = ?', [t, r.transfer.txId]);
          b.run('delete from splits where transaction_id = ?', [r.transfer.txId]);
        } else {
          const other = saveTransaction(b, {
            account_id: r.transfer.accountId, date: r.date, amount: -r.amount, payee: r.payee, purpose: r.purpose || null, autoCategorize: false,
          });
          b.run('update transactions set transfer_id = ?, category_id = null where id = ?', [t, other]);
        }
        transfers++;
      }
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
    return { accountId, imported, snapshots, balance, transfers };
  });
}
