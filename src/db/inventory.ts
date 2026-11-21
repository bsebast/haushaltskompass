import type { Book } from './core';
import { uid, now } from '../lib/id';
import { today } from '../lib/dates';

/** Inventar: Wertgegenstände mit Kaufpreis, Zeitwert und Beleg, z. B. für die Hausratversicherung. */

export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  room: string | null;
  owner: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  /** von Hand gesetzter Zeitwert; leer = aus Nutzungsdauer berechnet oder Kaufpreis */
  current_value: number | null;
  /** Nutzungsdauer in Jahren für die lineare Abschreibung */
  useful_life: number | null;
  serial: string | null;
  warranty_until: string | null;
  insurance: string | null;
  note: string | null;
  document_id: string | null;
  doc_name: string | null;
  doc_mime: string | null;
}

export type InventoryInput = Omit<InventoryItem, 'id' | 'doc_name' | 'doc_mime'> & { id?: string };

export const MAX_DOC = 20 * 1024 * 1024;

export function listInventory(b: Book): InventoryItem[] {
  return b.all<InventoryItem>(
    `select i.*, d.filename as doc_name, d.mime as doc_mime from inventory i left join documents d on d.id = i.document_id
     order by coalesce(i.room, '') collate nocase, coalesce(i.category, '') collate nocase, i.name collate nocase`,
  );
}

export function saveInventory(b: Book, x: InventoryInput): string {
  const name = x.name.trim();
  if (!name) throw new Error('Bitte einen Namen eingeben.');
  if (x.useful_life != null && (!Number.isInteger(x.useful_life) || x.useful_life < 1 || x.useful_life > 100)) throw new Error('Die Nutzungsdauer muss zwischen 1 und 100 Jahren liegen.');
  const t = now();
  const vals = [name, x.category || null, x.room || null, x.owner || null, x.purchase_date || null, x.purchase_price ?? null, x.current_value ?? null,
    x.useful_life ?? null, x.serial || null, x.warranty_until || null, x.insurance || null, x.note || null, x.document_id ?? null, t];
  if (x.id) {
    b.run(`update inventory set name=?, category=?, room=?, owner=?, purchase_date=?, purchase_price=?, current_value=?, useful_life=?, serial=?,
      warranty_until=?, insurance=?, note=?, document_id=?, updated_at=? where id=?`, [...vals, x.id]);
    return x.id;
  }
  const id = uid();
  b.run(`insert into inventory (name, category, room, owner, purchase_date, purchase_price, current_value, useful_life, serial, warranty_until, insurance, note,
    document_id, updated_at, id, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, id, t]);
  return id;
}

export function deleteInventory(b: Book, id: string) {
  b.tx(() => {
    const doc = b.value<string>('select document_id from inventory where id = ?', [id]);
    b.run('delete from inventory where id = ?', [id]);
    if (doc) removeDocumentIfUnused(b, doc);
  });
}

/* ---------- Belege ---------- */

export function addDocument(b: Book, filename: string, mime: string, data: Uint8Array): string {
  if (data.byteLength > MAX_DOC) throw new Error('Der Beleg ist größer als 20 MB.');
  const id = uid();
  b.run('insert into documents (id, filename, mime, size, data, created_at) values (?,?,?,?,?,?)', [id, filename, mime || 'application/octet-stream', data.byteLength, data, now()]);
  return id;
}

export function getDocument(b: Book, id: string): { filename: string; mime: string; data: Uint8Array } | null {
  return b.get<{ filename: string; mime: string; data: Uint8Array }>('select filename, mime, data from documents where id = ?', [id]) ?? null;
}

export function removeDocumentIfUnused(b: Book, id: string) {
  const used = (b.value<number>('select count(*) from inventory where document_id = ?', [id]) ?? 0)
    + (b.value<number>('select count(*) from document_links where document_id = ?', [id]) ?? 0);
  if (!used) b.run('delete from documents where id = ?', [id]);
}

/* ---------- Zeitwert ---------- */

/** Zeitwert: von Hand gesetzt, sonst linear über die Nutzungsdauer, sonst der Kaufpreis. */
export function valueOf(x: Pick<InventoryItem, 'current_value' | 'purchase_price' | 'purchase_date' | 'useful_life'>, at = today()): number {
  if (x.current_value != null) return x.current_value;
  const price = x.purchase_price ?? 0;
  if (!x.useful_life || !x.purchase_date || !price) return price;
  // volle Monate seit dem Kauf
  const [y1, m1, d1] = x.purchase_date.split('-').map(Number);
  const [y2, m2, d2] = at.split('-').map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  return Math.max(0, Math.round(price * (1 - months / (x.useful_life * 12))));
}

export function inventoryTotals(items: InventoryItem[], at = today()) {
  return items.reduce((a, x) => ({ price: a.price + (x.purchase_price ?? 0), value: a.value + valueOf(x, at) }), { price: 0, value: 0 });
}

/** Garantie läuft in den nächsten days Tagen ab (oder ist heute noch gültig). */
export function warrantyEndingSoon(x: Pick<InventoryItem, 'warranty_until'>, days = 60, at = today()): boolean {
  if (!x.warranty_until || x.warranty_until < at) return false;
  const end = new Date(at + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + days);
  return x.warranty_until <= end.toISOString().slice(0, 10);
}

/** Inventar zum Vermögen zählen (Einstellung im Haushaltsbuch). */
export function inventoryInWealth(b: Book): boolean {
  return b.meta('inventory_in_wealth') === '1';
}

export function setInventoryInWealth(b: Book, on: boolean) {
  b.setMeta('inventory_in_wealth', on ? '1' : '0');
}

function cell(v: string | number | null | undefined) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const eur = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const de = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');

export function inventoryCsv(items: InventoryItem[], at = today()): string {
  const head = ['Gegenstand', 'Kategorie', 'Raum', 'Person', 'Kaufdatum', 'Kaufpreis', 'Zeitwert', 'Nutzungsdauer (Jahre)', 'Seriennummer', 'Garantie bis', 'Versicherung', 'Beleg', 'Bemerkung'];
  const rows = items.map((x) => [x.name, x.category, x.room, x.owner, de(x.purchase_date), eur(x.purchase_price), eur(valueOf(x, at)), x.useful_life, x.serial,
    de(x.warranty_until), x.insurance, x.doc_name, x.note].map(cell).join(';'));
  return [head.join(';'), ...rows].join('\r\n');
}
