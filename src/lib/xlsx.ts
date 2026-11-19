/**
 * Liest die erste Tabelle einer Excel-Datei im neuen Format (.xlsx) und gibt sie als
 * Semikolon-CSV zurück, damit der normale Bankimport sie verarbeiten kann.
 * Ohne zusätzliche Abhängigkeit: ZIP-Verzeichnis lesen, Einträge mit DecompressionStream entpacken.
 */

interface ZipEntry { name: string; method: number; offset: number; size: number }

function zipEntries(u: Uint8Array): ZipEntry[] {
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Excel-Datei ist beschädigt (ZIP-Verzeichnis fehlt).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nameLen));
    // Daten beginnen nach dem lokalen Kopf, dessen Längenfelder abweichen können
    const lName = v.getUint16(local + 26, true);
    const lExtra = v.getUint16(local + 28, true);
    out.push({ name, method, offset: local + 30 + lName + lExtra, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(u: Uint8Array, entries: ZipEntry[], name: string): Promise<string | null> {
  const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!e) return null;
  const raw = u.subarray(e.offset, e.offset + e.size);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!bytes) throw new Error('Die Excel-Datei nutzt eine nicht unterstützte Kompression.');
  return new TextDecoder().decode(bytes).replace(/^﻿/, '');
}

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/** Text aus <t>-Elementen, mit oder ohne Namensraum-Präfix (z. B. <x:t>) */
const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescapeXml(m[1])).join('');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function isXlsx(data: ArrayBuffer | Uint8Array): boolean {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  return u.length > 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04;
}

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(u);
  // erste Tabelle über die Beziehungen der Arbeitsmappe finden, sonst die erste Datei unter worksheets/
  let sheetPath: string | null = null;
  const wb = await readEntry(u, entries, 'xl/workbook.xml');
  const rels = await readEntry(u, entries, 'xl/_rels/workbook.xml.rels');
  const rid = wb ? /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1] ?? /<(?:\w+:)?sheet\b[^>]*\bid="([^"]+)"/.exec(wb)?.[1] : null;
  if (rid && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  sheetPath ??= entries.map((e) => e.name).find((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n)) ?? null;
  const sheet = sheetPath ? await readEntry(u, entries, sheetPath) : null;
  if (!sheet) throw new Error('In der Excel-Datei wurde keine Tabelle gefunden.');
  const sstXml = await readEntry(u, entries, 'xl/sharedStrings.xml');
  const shared = sstXml ? [...sstXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1])) : [];

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const row: string[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(inner);
      else if (v !== undefined) value = unescapeXml(v);
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push('');
      row[i] = value;
    }
    rows.push(row);
  }
  return rows;
}

export async function xlsxToCsv(data: ArrayBuffer | Uint8Array): Promise<string> {
  const rows = await readXlsx(data);
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
