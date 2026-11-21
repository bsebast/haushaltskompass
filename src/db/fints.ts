import type { Book } from './core';
import type { BankRow, BankStatement } from './bankcsv';
import { cleanPurpose, realPayee, FINTS_HASH_PREFIX } from './bankcsv';

export { FINTS_HASH_PREFIX, isFintsHash } from './bankcsv';

/**
 * Kontoumsätze, die der lokale FinTS-Dienst (vite-plugin-fints.ts) von der Bank abruft.
 * Die Umwandlung in ein BankStatement sorgt dafür, dass abgerufene Buchungen denselben Weg gehen
 * wie ein Dateiimport: Dublettenerkennung, Regeln, Verträge, Umbuchungen mit Gegenbuchung.
 */

/** Eine gebuchte Umsatzzeile, wie sie der Dienst liefert (Beträge in Cent). */
export interface FintsTx {
  /** Buchungstag JJJJ-MM-TT */
  date: string;
  valueDate: string | null;
  amount: number;
  /** Name der Gegenseite */
  name: string;
  /** IBAN oder Kontonummer der Gegenseite */
  counterAccount: string | null;
  purpose: string;
  bookingText: string;
}

export interface FintsAccountData {
  iban: string | null;
  accountNumber: string;
  /** Produktname laut Bank, z. B. „Girokonto“ */
  accountName: string | null;
  bank: string | null;
  holder: string | null;
  /** Saldo vor der ersten gelieferten Buchung, falls die Bank ihn meldet */
  openingBalance: number | null;
  /** Saldo nach der letzten gelieferten Buchung */
  closingBalance: number | null;
  transactions: FintsTx[];
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Verwendungszweck ohne SEPA-Kennungen, auch wenn er mit einer Kennung beginnt. */
function fintsPurpose(raw: string): string {
  let s = clean(raw);
  const svwz = /SVWZ\+\s?(.*?)(?=\s?(?:EREF|MREF|CRED|KREF|ABWA|ABWE|IBAN|BIC)\+|$)/.exec(s);
  if (svwz) s = svwz[1];
  return cleanPurpose(s.replace(/^(?:EREF|MREF|CRED|KREF)\+\S*\s*/g, ''));
}

/** Wandelt die abgerufenen Umsätze in einen Kontoauszug für planBankImport/commitBankImport um. */
export function fintsToStatement(d: FintsAccountData): BankStatement {
  const iban = d.iban ? d.iban.replace(/\s/g, '').toUpperCase() : null;
  const txs = [...d.transactions].sort((a, z) => a.date.localeCompare(z.date));
  if (!txs.length) throw new Error('Die Bank hat für den Zeitraum keine gebuchten Umsätze geliefert.');
  const sum = txs.reduce((a, t) => a + t.amount, 0);
  const warnings: string[] = [];
  let start = d.openingBalance;
  let end = d.closingBalance;
  if (start === null && end !== null) start = end - sum;
  if (end === null && start !== null) end = start + sum;
  if (d.openingBalance !== null && d.closingBalance !== null && d.openingBalance + sum !== d.closingBalance) {
    warnings.push(`Anfangssaldo plus Buchungen ergibt ${(d.openingBalance + sum) / 100} €, die Bank meldet ${d.closingBalance / 100} €. Fehlen Buchungen?`);
  }
  const owner = iban ?? d.accountNumber;
  const seen = new Map<string, number>();
  let run = start ?? 0;
  const dayEnd = new Map<string, number>();
  const rows: BankRow[] = txs.map((t, i) => {
    run += t.amount;
    const bookingText = clean(t.bookingText);
    const purpose = fintsPurpose(t.purpose);
    const rawPayee = clean(t.name);
    const counter = clean(t.counterAccount).replace(/\s/g, '').toUpperCase();
    const counterIban = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(counter) ? counter : null;
    const base = `${FINTS_HASH_PREFIX}${owner}|${t.date}|${t.amount}|${rawPayee}|${purpose}`;
    // Abgerufen wird immer tageweise, also sind alle gleichen Buchungen eines Tages dabei:
    // das wievielte gleiche Vorkommen ist stabil, auch wenn der nächste Abruf früher beginnt
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const hash = `${base}|#${n}`;
    if (start !== null) dayEnd.set(t.date, run);
    return {
      line: i + 1, date: t.date, amount: t.amount, rawPayee, purpose, bookingText, counterIban,
      securities: /^wertpapier/i.test(bookingText),
      bankCategory: null,
      payee: (realPayee(rawPayee, purpose) || d.bank || bookingText || 'Unbekannt').split(/\s+(?:WPKNR:|ISIN:|DEPOTBESTAND:)/)[0],
      balance: start !== null ? run : null,
      hash,
    };
  });
  return {
    accountName: d.accountName, iban, bank: d.bank, rows, warnings, dayEnd,
    from: rows[0].date, to: rows[rows.length - 1].date,
    endBalance: end, startBalance: start, kind: 'checking', holder: d.holder, refIban: null, source: 'fints',
  };
}

/** Bankleitzahl aus einer deutschen IBAN. */
export function blzFromIban(iban: string | null | undefined): string | null {
  const s = (iban ?? '').replace(/\s/g, '').toUpperCase();
  return /^DE\d{20}$/.test(s) ? s.slice(4, 12) : null;
}

export interface FintsBank { key: string; name: string; url: string; userHint: string; tanHint: string }

/**
 * Bekannte FinTS-Zugänge. Volksbanken und Raiffeisenbanken laufen alle über den Server von Atruvia,
 * die eigene BLZ kommt aus der IBAN. Weitere Banken lassen sich mit eigener URL eintragen.
 */
export const FINTS_BANKS: FintsBank[] = [
  { key: 'vr', name: 'Volksbank / Raiffeisenbank', url: 'https://fints1.atruvia.de/cgi-bin/hbciservlet', userHint: 'VR-NetKey oder Alias', tanHint: 'Freigabe in der App SecureGo plus' },
  { key: 'comdirect', name: 'comdirect', url: 'https://fints.comdirect.de/fints', userHint: 'Zugangsnummer', tanHint: 'Freigabe per photoTAN-App (Push)' },
  { key: 'ing', name: 'ING', url: 'https://fints.ing.de/fints/', userHint: 'Zugangsnummer (10 Ziffern)', tanHint: 'Freigabe in der App ING Banking' },
];

const COMDIRECT_BLZ = /^2004(1111|1133|1144|1155|1166|1177)$/;

/** Ordnet eine BLZ einem bekannten Zugang zu (Volksbanken: Bankname enthält Volksbank, Raiffeisen, VR …). */
export function guessFintsBank(blz: string | null, bankName: string | null): FintsBank | null {
  if (blz && COMDIRECT_BLZ.test(blz)) return FINTS_BANKS[1];
  if (blz === '50010517') return FINTS_BANKS[2];
  const n = (bankName ?? '').toLowerCase();
  if (/comdirect/.test(n)) return FINTS_BANKS[1];
  if (/\bing\b|ing-diba/.test(n)) return FINTS_BANKS[2];
  // Volksbanken und Raiffeisenbanken: vierte Stelle der BLZ ist 6 oder 9 (Genossenschaftsbanken)
  if (/volksbank|raiffeisen|vr[ -]?bank|\bvr\b|spar- und darlehnskasse|genossenschaft/.test(n) || (blz && /^\d{3}[69]/.test(blz))) return FINTS_BANKS[0];
  return null;
}

/**
 * Ab wann abgerufen wird: zehn Tage vor der letzten schon importierten Bankbuchung (die Überlappung erkennt
 * die Dublettenprüfung), ohne bisherigen Import 90 Tage zurück. Mehr als 90 Tage verlangen viele Banken eine TAN.
 */
export function defaultFetchFrom(b: Book, accountId: string | null, today = new Date()): string {
  const back = (days: number, from: Date) => { const d = new Date(from); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  const last = accountId
    ? b.get<{ d: string | null }>("select max(date) d from transactions where account_id = ? and import_hash like 'bank:%'", [accountId])?.d
    : null;
  return last ? back(10, new Date(`${last}T12:00:00Z`)) : back(89, today);
}
