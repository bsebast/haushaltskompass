/**
 * Kleiner Leser für alte Excel-Dateien (.xls, BIFF8 in einem OLE-Container), wie sie manche Banken exportieren.
 * Liest nur Zellwerte (Text, Zahlen, Datumszahlen, Formel-Ergebnisse), keine Formatierung. Ohne Fremdbibliothek.
 */

export type Cell = string | number | boolean | null;
export interface XlsSheet { name: string; rows: Cell[][] }

/* ---------- OLE Compound File ---------- */

function readCfbStream(buf: Uint8Array, wanted: string[]): Uint8Array | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('Die Datei ist keine Excel-Datei im alten Format (.xls).');
  const secSize = 1 << dv.getUint16(30, true);
  const miniSize = 1 << dv.getUint16(32, true);
  const numFat = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  let difStart = dv.getUint32(68, true);
  const off = (s: number) => (s + 1) * secSize;
  // FAT-Sektoren aus dem Kopf und der DIFAT-Kette
  const fatSecs: number[] = [];
  for (let i = 0; i < 109 && fatSecs.length < numFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
  while (fatSecs.length < numFat && difStart < 0xfffffffa) {
    const o = off(difStart);
    for (let i = 0; i < secSize / 4 - 1 && fatSecs.length < numFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
    difStart = dv.getUint32(o + secSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let s = start; s < 0xfffffffa && out.length <= table.length; s = table[s]) out.push(s);
    return out;
  };
  const readChain = (start: number) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(buf.subarray(off(s), off(s) + secSize), i * secSize));
    return out;
  };
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = ddv.getUint16(o + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, len / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const e = entries.find((x) => x.type === 2 && wanted.includes(x.name));
  if (!e) return null;
  if (e.size >= miniCutoff || !root) return readChain(e.start).subarray(0, e.size);
  // kleiner Stream im Mini-Stream
  const miniFat: number[] = [];
  const mf = readChain(miniFatStart);
  const mdv = new DataView(mf.buffer);
  for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true));
  const ministream = readChain(root.start);
  const secs = chain(e.start, miniFat);
  const out = new Uint8Array(secs.length * miniSize);
  secs.forEach((s, i) => out.set(ministream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
  return out.subarray(0, e.size);
}

/* ---------- BIFF8 ---------- */

function rk(v: number): number {
  let n: number;
  if (v & 2) n = v >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, v & 0xfffffffc, true);
    b.setUint32(0, 0, true);
    n = b.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

/** Liest alle Arbeitsblätter einer .xls-Datei. */
export function readXls(data: ArrayBuffer | Uint8Array): XlsSheet[] {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = readCfbStream(buf, ['Workbook', 'Book']);
  if (!wb) throw new Error('In der Excel-Datei wurde kein Arbeitsblatt gefunden.');
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);

  // Datensätze einsammeln, CONTINUE-Blöcke an den Vorgänger hängen (Grenzen merken für Texte im SST)
  type Rec = { type: number; data: Uint8Array; breaks: number[] };
  const recs: Rec[] = [];
  for (let o = 0; o + 4 <= wb.length;) {
    const type = dv.getUint16(o, true);
    const len = dv.getUint16(o + 2, true);
    const data = wb.subarray(o + 4, o + 4 + len);
    if (type === 0x3c && recs.length) {
      const prev = recs[recs.length - 1];
      const merged = new Uint8Array(prev.data.length + data.length);
      merged.set(prev.data); merged.set(data, prev.data.length);
      prev.breaks.push(prev.data.length);
      prev.data = merged;
    } else recs.push({ type, data, breaks: [] });
    o += 4 + len;
  }

  const sst: string[] = [];
  const sheets: { name: string; pos: number }[] = [];
  const bofPos: number[] = [];
  let pos = 0;
  for (const r of recs) {
    if (r.type === 0x85) { // BOUNDSHEET
      const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const cch = r.data[6];
      const flags = r.data[7];
      sheets.push({ name: readChars(r.data, 8, cch, flags & 1), pos: d.getUint32(0, true) });
    } else if (r.type === 0xfc) parseSst(r, sst);
  }
  // Blätter anhand der BOF-Positionen zuordnen
  const out: XlsSheet[] = [];
  let cur: { name: string; cells: Map<number, Map<number, Cell>> } | null = null;
  let sheetIdx = -1;
  let depth = 0;
  for (const r of recs) {
    const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    if (r.type === 0x809) {
      depth++;
      bofPos.push(pos);
      const dt = r.data.length >= 4 ? d.getUint16(2, true) : 0;
      if (dt === 0x10 && depth === 1) { sheetIdx++; cur = { name: sheets[sheetIdx]?.name ?? `Blatt ${sheetIdx + 1}`, cells: new Map() }; }
    } else if (r.type === 0x0a) {
      depth--;
      if (cur && depth === 0) { out.push(toSheet(cur.name, cur.cells)); cur = null; }
    } else if (cur) {
      const set = (row: number, col: number, v: Cell) => {
        if (!cur!.cells.has(row)) cur!.cells.set(row, new Map());
        cur!.cells.get(row)!.set(col, v);
      };
      if (r.type === 0xfd) set(d.getUint16(0, true), d.getUint16(2, true), sst[d.getUint32(6, true)] ?? ''); // LABELSST
      else if (r.type === 0x203) set(d.getUint16(0, true), d.getUint16(2, true), d.getFloat64(6, true)); // NUMBER
      else if (r.type === 0x27e) set(d.getUint16(0, true), d.getUint16(2, true), rk(d.getInt32(6, true))); // RK
      else if (r.type === 0xbd) { // MULRK
        const row = d.getUint16(0, true);
        const first = d.getUint16(2, true);
        const n = (r.data.length - 6) / 6;
        for (let i = 0; i < n; i++) set(row, first + i, rk(d.getInt32(4 + i * 6 + 2, true)));
      } else if (r.type === 0x204) { // LABEL
        const len = d.getUint16(6, true);
        set(d.getUint16(0, true), d.getUint16(2, true), readChars(r.data, 9, len, r.data[8] & 1));
      } else if (r.type === 0x06) { // FORMULA: zwischengespeichertes Ergebnis
        const row = d.getUint16(0, true);
        const col = d.getUint16(2, true);
        if (d.getUint16(12, true) === 0xffff) {
          const kind = r.data[6];
          if (kind === 1) set(row, col, r.data[8] !== 0);
          else if (kind === 0) set(row, col, ''); // Text folgt im STRING-Datensatz
          else set(row, col, null);
          if (kind === 0) (cur as unknown as { pending: [number, number] }).pending = [row, col];
        } else set(row, col, d.getFloat64(6, true));
      } else if (r.type === 0x207) { // STRING nach FORMULA
        const p = (cur as unknown as { pending?: [number, number] }).pending;
        if (p) set(p[0], p[1], readChars(r.data, 3, d.getUint16(0, true), r.data[2] & 1));
      } else if (r.type === 0x205) { // BOOLERR
        set(d.getUint16(0, true), d.getUint16(2, true), r.data[7] ? null : r.data[6] !== 0);
      }
    }
    pos += 4 + r.data.length;
  }
  return out;
}

function readChars(data: Uint8Array, at: number, n: number, wide: number): string {
  let s = '';
  if (wide) for (let i = 0; i < n; i++) s += String.fromCharCode(data[at + i * 2] | (data[at + i * 2 + 1] << 8));
  else for (let i = 0; i < n; i++) s += String.fromCharCode(data[at + i]);
  return s;
}

function parseSst(r: { data: Uint8Array; breaks: number[] }, sst: string[]) {
  const d = r.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const unique = dv.getUint32(4, true);
  let o = 8;
  const breaks = new Set(r.breaks);
  for (let k = 0; k < unique && o < d.length; k++) {
    const cch = dv.getUint16(o, true);
    let flags = d[o + 2];
    o += 3;
    let runs = 0;
    let ext = 0;
    if (flags & 8) { runs = dv.getUint16(o, true); o += 2; }
    if (flags & 4) { ext = dv.getUint32(o, true); o += 4; }
    let s = '';
    for (let i = 0; i < cch; i++) {
      if (breaks.has(o) && i > 0) { flags = d[o]; o += 1; } // Text läuft im CONTINUE weiter, mit neuem Flag-Byte
      if (flags & 1) { s += String.fromCharCode(dv.getUint16(o, true)); o += 2; } else { s += String.fromCharCode(d[o]); o += 1; }
    }
    o += runs * 4 + ext;
    sst.push(s);
  }
}

function toSheet(name: string, cells: Map<number, Map<number, Cell>>): XlsSheet {
  const maxRow = Math.max(-1, ...cells.keys());
  const rows: Cell[][] = [];
  for (let i = 0; i <= maxRow; i++) {
    const r = cells.get(i);
    if (!r) { rows.push([]); continue; }
    const maxCol = Math.max(...r.keys());
    rows.push(Array.from({ length: maxCol + 1 }, (_, c) => (r.has(c) ? r.get(c)! : null)));
  }
  return { name, rows };
}

/** Excel-Datumszahl (Tage seit 30.12.1899) in 'YYYY-MM-DD'. */
export function excelDate(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  return d.toISOString().slice(0, 10);
}

/** Erstes Blatt einer .xls-Datei als Semikolon-CSV (für die vorhandenen CSV-Importe). */
export function xlsToCsv(data: ArrayBuffer | Uint8Array): string {
  const [sheet] = readXls(data);
  if (!sheet) throw new Error('Die Excel-Datei enthält kein Blatt.');
  const fmt = (v: Cell) => {
    if (v === null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  return sheet.rows.map((r) => r.map(fmt).join(';')).join('\r\n');
}

export function isXls(data: ArrayBuffer | Uint8Array): boolean {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}
