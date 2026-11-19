import type { Transaction } from '../db/types';
import { formatDate } from './dates';

function cell(v: string | null | undefined) {
  const s = v ?? '';
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Transaction[]): string {
  const head = ['Datum', 'Konto', 'Empfänger/Auftraggeber', 'Verwendungszweck', 'Kategorie', 'Betrag', 'Notiz'];
  const lines = rows.map((t) => [
    formatDate(t.date), t.account_name, t.payee, t.purpose,
    t.transfer_id ? 'Umbuchung' : t.split_count ? 'Aufgeteilt' : t.category_name,
    (t.amount / 100).toFixed(2).replace('.', ','), t.note,
  ].map(cell).join(';'));
  return [head.join(';'), ...lines].join('\r\n');
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(rows: Transaction[]) {
  download(`buchungen-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8');
}
