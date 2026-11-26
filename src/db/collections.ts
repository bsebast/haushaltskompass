import type { Book } from './core';
import { uid, now } from '../lib/id';

/**
 * Sammlungen: Buchungen quer zu Kategorien bündeln, z. B. „Urlaub Mallorca 2026“ oder „Umbau Bad“.
 * Eine Buchung kann in mehreren Sammlungen liegen. Umbuchungen zählen in den Summen nicht.
 */

export interface Collection {
  id: string;
  name: string;
  note: string | null;
  color: string | null;
  archived: number;
  count: number;
  expense: number; // Summe Ausgaben (negativ)
  income: number;
  first: string | null;
  last: string | null;
}

const SERIES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

export function listCollections(b: Book, includeArchived = true): Collection[] {
  return b.all<Collection>(
    `select c.*, count(t.id) as count,
       coalesce(sum(case when t.transfer_id is null and t.amount < 0 then t.amount end), 0) as expense,
       coalesce(sum(case when t.transfer_id is null and t.amount > 0 then t.amount end), 0) as income,
       min(t.date) as first, max(t.date) as last
     from collections c left join collection_links l on l.collection_id = c.id left join transactions t on t.id = l.transaction_id
     ${includeArchived ? '' : 'where c.archived = 0'}
     group by c.id order by c.archived, coalesce(max(t.date), c.created_at) desc, c.name collate nocase`,
  );
}

export function saveCollection(b: Book, c: { id?: string; name: string; note?: string | null; color?: string | null; archived?: boolean }): string {
  const name = c.name.trim();
  if (!name) throw new Error('Bitte einen Namen für die Sammlung eingeben.');
  if (name.length > 80) throw new Error('Der Name ist zu lang (höchstens 80 Zeichen).');
  const t = now();
  if (c.id) {
    b.run('update collections set name = ?, note = ?, color = coalesce(?, color), archived = ?, updated_at = ? where id = ?',
      [name, c.note?.trim() || null, c.color ?? null, c.archived ? 1 : 0, t, c.id]);
    return c.id;
  }
  const id = uid();
  const n = b.value<number>('select count(*) from collections') ?? 0;
  b.run('insert into collections (id, name, note, color, archived, created_at, updated_at) values (?,?,?,?,?,?,?)',
    [id, name, c.note?.trim() || null, c.color ?? SERIES[n % SERIES.length], c.archived ? 1 : 0, t, t]);
  return id;
}

export function deleteCollection(b: Book, id: string) {
  b.run('delete from collections where id = ?', [id]);
}

/** Buchungen hinzufügen; bei einer Umbuchung kommen beide Hälften dazu. */
export function addToCollection(b: Book, id: string, txIds: string[]) {
  b.tx(() => {
    for (const t of txIds) {
      b.run(
        `insert or ignore into collection_links (collection_id, transaction_id)
         select ?, x.id from transactions x where x.id = ? or (x.transfer_id is not null and x.transfer_id = (select transfer_id from transactions where id = ?))`,
        [id, t, t],
      );
    }
  });
}

export function removeFromCollection(b: Book, id: string, txIds: string[]) {
  b.tx(() => {
    for (const t of txIds) b.run('delete from collection_links where collection_id = ? and transaction_id = ?', [id, t]);
  });
}

export function collectionIds(b: Book, txId: string): string[] {
  return b.all<{ collection_id: string }>('select collection_id from collection_links where transaction_id = ?', [txId]).map((r) => r.collection_id);
}

/** Sammlungen einer Buchung setzen (aus dem Buchungsdialog). */
export function setTxCollections(b: Book, txId: string, ids: string[]) {
  b.tx(() => {
    b.run('delete from collection_links where transaction_id = ?', [txId]);
    for (const id of ids) b.run('insert or ignore into collection_links (collection_id, transaction_id) values (?, ?)', [id, txId]);
  });
}

/** Ausgaben einer Sammlung je Kategorie (Hauptkategorie), Splits anteilig. */
export function collectionByCategory(b: Book, id: string): { category_id: string | null; name: string; color: string | null; amount: number }[] {
  return b.all(
    `with lines as (
       select coalesce(s.category_id, t.category_id) as cat, coalesce(s.amount, t.amount) as amount
       from collection_links l join transactions t on t.id = l.transaction_id left join splits s on s.transaction_id = t.id
       where l.collection_id = ? and t.transfer_id is null
     )
     select coalesce(p.id, c.id) as category_id, coalesce(p.name, c.name, 'Ohne Kategorie') as name, coalesce(p.color, c.color) as color, sum(lines.amount) as amount
     from lines left join categories c on c.id = lines.cat left join categories p on p.id = c.parent_id
     group by 1 order by sum(lines.amount)`,
    [id],
  );
}
