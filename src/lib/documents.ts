import type { Book } from '../db/core';
import { getDocument } from '../db/inventory';
import { download } from './csvExport';

/** Öffnet einen gespeicherten Beleg in einem neuen Tab, sonst als Download. */
export function openDocument(b: Book, id: string) {
  const d = getDocument(b, id);
  if (!d) return;
  const url = URL.createObjectURL(new Blob([d.data as BlobPart], { type: d.mime }));
  const w = window.open(url, '_blank');
  if (!w) download(d.filename, d.data as BlobPart, d.mime);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
