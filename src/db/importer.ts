import type { Book } from './core';
import type { AccountType } from './types';
import {
  listAccounts, saveAccount, saveSnapshot, saveTransaction, saveTransfer, listHoldings, saveHolding, listPensions, savePension,
} from './repo';
import { listContracts, saveContract, contractKey, resolveCategory, parseDue, parseInterval, type Interval } from './contracts';

/**
 * Austauschformat für einen Gesamtimport (z. B. aus einer Excel-Übersicht erzeugt).
 * Alle Beträge in Euro als Zahl, Datumswerte als 'YYYY-MM-DD'.
 */
export interface ImportFile {
  format: 'haushaltskompass-import';
  version: 1;
  source?: string;
  accounts?: {
    key: string; name: string; type: AccountType; owner?: string | null; bank?: string | null; note?: string | null;
    interest_rate?: number | null; exemption?: number | null; exemption_used?: number | null; archived?: boolean;
    snapshots?: { date: string; balance: number }[];
    transactions?: { date: string; amount: number; payee?: string | null; purpose?: string | null; category?: string | null }[];
  }[];
  transfers?: { from: string; to: string; date: string; amount: number; note?: string | null }[];
  holdings?: {
    account?: string | null; owner?: string | null; wkn?: string | null; isin?: string | null; name: string; quantity: number;
    cost_value?: number | null; price?: number | null; market_value?: number | null; as_of?: string | null;
  }[];
  contracts?: {
    name: string; person?: string | null; purpose?: string | null; kind?: string | null; category?: string | null; account?: string | null;
    amount: number; interval: string; due?: string | null; payment_method?: string | null; note?: string | null; notice_period?: string | null;
    doc_ref?: string | null; advisor?: string | null; death_action?: string | null; status?: 'confirmed' | 'ended'; start_date?: string | null;
  }[];
  pensions?: {
    person?: string | null; provider: string; contribution?: number | null; interval?: string | null; lump_sum?: number | null;
    monthly_pension?: number | null; projections?: (number | null)[]; start?: string | null; as_of?: string | null;
    advisor?: string | null; death_action?: string | null; note?: string | null;
  }[];
}

export interface ImportSummary {
  accountsNew: number; accountsExisting: number; snapshots: number; transactions: number; transfers: number;
  holdings: number; contractsNew: number; contractsMerged: number; contractsSkipped: number; pensions: number; warnings: string[];
}

const cents = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : Math.round(v * 100));
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function parseImportFile(text: string): ImportFile {
  let data: ImportFile;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (data?.format !== 'haushaltskompass-import' || data.version !== 1) throw new Error('Unbekanntes Importformat.');
  return data;
}

/** Führt den Import aus. Mit dryRun wird nur gezählt (alles in einer Transaktion, die zurückgerollt wird). */
export function runImport(b: Book, data: ImportFile, opts: { dryRun?: boolean } = {}): ImportSummary {
  const sum: ImportSummary = {
    accountsNew: 0, accountsExisting: 0, snapshots: 0, transactions: 0, transfers: 0, holdings: 0,
    contractsNew: 0, contractsMerged: 0, contractsSkipped: 0, pensions: 0, warnings: [],
  };
  const DRY = new Error('dry-run');
  try {
    b.tx(() => {
      const keyToId = new Map<string, string>();
      const accts = listAccounts(b, true);
      for (const a of data.accounts ?? []) {
        const hit = accts.find((x) => norm(x.name) === norm(a.name) && norm(x.bank) === norm(a.bank) && norm(x.owner) === norm(a.owner));
        let id: string;
        if (hit) {
          id = hit.id;
          sum.accountsExisting++;
        } else {
          id = saveAccount(b, {
            name: a.name, type: a.type, owner: a.owner ?? null, bank: a.bank ?? null, note: a.note ?? null, interest_rate: a.interest_rate ?? null,
            exemption: cents(a.exemption), exemption_used: cents(a.exemption_used), archived: !!a.archived,
          });
          sum.accountsNew++;
        }
        keyToId.set(a.key, id);
        for (const s of a.snapshots ?? []) {
          saveSnapshot(b, id, s.date, cents(s.balance) ?? 0);
          sum.snapshots++;
        }
        (a.transactions ?? []).forEach((t, i) => {
          const amount = cents(t.amount);
          if (!amount) return;
          const hash = `imp:${t.date}|${amount}|${t.payee ?? ''}|${t.purpose ?? ''}|${i}`;
          if (b.value('select 1 from transactions where account_id = ? and import_hash = ?', [id, hash])) return;
          saveTransaction(b, {
            account_id: id, date: t.date, amount, payee: t.payee ?? null, purpose: t.purpose ?? null, import_hash: hash,
            category_id: resolveCategory(b, t.category, amount > 0 ? 'income' : 'expense'),
          });
          sum.transactions++;
        });
      }
      for (const t of data.transfers ?? []) {
        const from = keyToId.get(t.from);
        const to = keyToId.get(t.to);
        const amount = cents(t.amount);
        if (!from || !to || !amount) { sum.warnings.push(`Umbuchung vom ${t.date} übersprungen (Konto fehlt)`); continue; }
        if (b.value('select 1 from transactions where account_id = ? and date = ? and amount = ? and transfer_id is not null', [from, t.date, -amount])) continue;
        saveTransfer(b, { from_account: from, to_account: to, date: t.date, amount, note: t.note ?? null });
        sum.transfers++;
      }
      const holdings = listHoldings(b);
      for (const h of data.holdings ?? []) {
        const accountId = h.account ? keyToId.get(h.account) ?? null : null;
        const hit = holdings.find((x) => norm(x.owner) === norm(h.owner) && norm(x.isin) === norm(h.isin) && norm(x.name) === norm(h.name));
        saveHolding(b, {
          id: hit?.id, account_id: accountId, owner: h.owner ?? null, wkn: h.wkn != null ? String(h.wkn) : null, isin: h.isin ?? null, name: h.name,
          quantity: h.quantity, cost_value: cents(h.cost_value), price: cents(h.price), market_value: cents(h.market_value), as_of: h.as_of ?? null,
        });
        sum.holdings++;
      }
      const existing = new Map(listContracts(b, true).map((c) => [contractKey(c.name, c.person, c.purpose, c.amount), c]));
      for (const c of data.contracts ?? []) {
        const amount = cents(c.amount);
        if (!c.name || !amount) { sum.contractsSkipped++; sum.warnings.push(`Vertrag „${c.name}“ ohne Betrag übersprungen`); continue; }
        const interval: Interval = parseInterval(c.interval) ?? 'monthly';
        const due = parseDue(c.due);
        const hit = existing.get(contractKey(c.name, c.person, c.purpose, amount));
        const extra = { notice_period: c.notice_period ?? null, doc_ref: c.doc_ref ?? null, advisor: c.advisor ?? null, death_action: c.death_action ?? null };
        if (hit) {
          // vorhandenen Vertrag nur um fehlende Angaben ergänzen
          saveContract(b, {
            ...hit, due_months: hit.due_months ? hit.due_months.split(',').map(Number) : [], status: hit.status === 'ended' ? 'ended' : 'confirmed',
            notice_period: hit.notice_period ?? extra.notice_period, doc_ref: hit.doc_ref ?? extra.doc_ref,
            advisor: hit.advisor ?? extra.advisor, death_action: hit.death_action ?? extra.death_action, note: hit.note ?? c.note ?? null,
          });
          sum.contractsMerged++;
          continue;
        }
        saveContract(b, {
          name: c.name, person: c.person ?? null, purpose: c.purpose ?? null, kind: c.kind ?? null, amount, interval,
          due_day: due.day, due_months: due.months, payment_method: c.payment_method ?? null, note: c.note ?? null,
          category_id: resolveCategory(b, c.category, amount > 0 ? 'income' : 'expense'),
          account_id: c.account ? keyToId.get(c.account) ?? null : null, status: c.status ?? 'confirmed', start_date: c.start_date ?? null,
          end_date: c.status === 'ended' ? c.start_date ?? null : null, ...extra,
        });
        sum.contractsNew++;
      }
      const pensions = listPensions(b);
      for (const p of data.pensions ?? []) {
        const hit = pensions.find((x) => norm(x.person) === norm(p.person) && norm(x.provider) === norm(p.provider));
        const pr = p.projections ?? [];
        savePension(b, {
          id: hit?.id, person: p.person ?? null, provider: p.provider, contribution: cents(p.contribution), interval: p.interval ?? null,
          lump_sum: cents(p.lump_sum), monthly_pension: cents(p.monthly_pension), projection1: cents(pr[0]), projection2: cents(pr[1]),
          projection3: cents(pr[2]), start_text: p.start ?? null, as_of: p.as_of ?? null, advisor: p.advisor ?? null,
          death_action: p.death_action ?? null, note: p.note ?? null,
        });
        sum.pensions++;
      }
      if (opts.dryRun) throw DRY;
    });
  } catch (e) {
    if (e !== DRY) throw e;
  }
  return sum;
}
