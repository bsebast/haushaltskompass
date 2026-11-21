import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftRight, Split, ExternalLink, Maximize2, Minimize2, Printer, X } from 'lucide-react';
import type { Transaction } from '../db/types';
import type { Book } from '../db/core';
import type { Line } from '../db/analytics';
import { listTransactions, type TxFilter } from '../db/repo';
import { useQuery } from '../state';
import { Modal, Money, Dot } from './ui';
import { useTxDialog } from './Layout';
import { formatDate } from '../lib/dates';

/**
 * Detailansicht für Auswertungen: Ein Klick auf eine Tabellenzelle oder einen Teil einer Grafik
 * öffnet die Buchungen, aus denen sich der Wert zusammensetzt.
 */

/** Eine Buchung mit dem Betrag, der in den angeklickten Wert eingeht (bei aufgeteilten Buchungen nur der passende Teil). */
export interface DrillPart { id: string; amount: number }

export interface Drill {
  title: string;
  subtitle?: string;
  load: (b: Book) => DrillPart[];
  /** optional: dieselbe Auswahl in der Buchungsliste */
  link?: string;
}

/** Fasst Auswertungszeilen je Buchung zusammen. */
export function partsFromLines(lines: Line[]): DrillPart[] {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.id, (m.get(l.id) ?? 0) + l.amount);
  return [...m.entries()].map(([id, amount]) => ({ id, amount }));
}

/** Buchungen direkt aus der Buchungsliste (z. B. inklusive Umbuchungen für Konten und Vermögen). */
export function partsFromTx(b: Book, f: TxFilter): DrillPart[] {
  return listTransactions(b, f).map((t) => ({ id: t.id, amount: t.amount }));
}

const DrillCtx = createContext<(d: Drill) => void>(() => {});
export const useDrill = () => useContext(DrillCtx);

export function DrillProvider({ children }: { children: React.ReactNode }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const close = useCallback(() => setDrill(null), []);
  return (
    <DrillCtx.Provider value={setDrill}>
      {children}
      {drill && <DrillModal drill={drill} onClose={close} />}
    </DrillCtx.Provider>
  );
}

type Row = { t: Transaction; part: number };

/** Lädt die Buchungen zu den Teilen, immer mit dem aktuellen Stand (nach einer Änderung sofort neu). */
function useDrillRows(load: (b: Book) => DrillPart[], dep: unknown): Row[] {
  return useQuery((b) => {
    const parts = load(b);
    const txs = parts.length ? listTransactions(b, { ids: parts.map((p) => p.id) }) : [];
    const share = new Map(parts.map((p) => [p.id, p.amount]));
    return txs.map((t) => ({ t, part: share.get(t.id) ?? t.amount }));
  }, [dep]);
}

/* ---------- Übergabe an einen neuen Tab ---------- */

const TAB_PREFIX = 'hk:drill:';
interface TabDrill { title: string; subtitle?: string; parts: DrillPart[]; created: number }

/** Öffnet die Buchungen in einem neuen Browser-Tab. Die Auswahl wird im Browser abgelegt, damit der Tab sie auch nach einem Neuladen findet. */
export function openDrillTab(d: { title: string; subtitle?: string; parts: DrillPart[] }) {
  const id = Math.random().toString(36).slice(2, 10);
  try {
    // Einträge älter als 30 Tage aufräumen
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(TAB_PREFIX)) continue;
      try { if (Date.now() - (JSON.parse(localStorage.getItem(k) ?? '{}') as TabDrill).created > 30 * 864e5) localStorage.removeItem(k); } catch { localStorage.removeItem(k); }
    }
    localStorage.setItem(TAB_PREFIX + id, JSON.stringify({ ...d, created: Date.now() } satisfies TabDrill));
  } catch {
    alert('Der neue Tab konnte nicht vorbereitet werden (Browser-Speicher voll oder gesperrt).');
    return;
  }
  window.open(`${location.pathname}#/details/${id}`, '_blank');
}

function readTabDrill(id: string): TabDrill | null {
  try { return JSON.parse(localStorage.getItem(TAB_PREFIX + id) ?? 'null'); } catch { return null; }
}

/* ---------- Liste ---------- */

type Sort = 'date' | 'amount' | 'payee' | 'category' | 'account';
const sorters: Record<Sort, (a: Row, b: Row) => number> = {
  date: (a, b) => b.t.date.localeCompare(a.t.date),
  amount: (a, b) => Math.abs(b.part) - Math.abs(a.part),
  payee: (a, b) => (a.t.payee ?? '').localeCompare(b.t.payee ?? '', 'de'),
  category: (a, b) => (a.t.category_name ?? '').localeCompare(b.t.category_name ?? '', 'de'),
  account: (a, b) => a.t.account_name.localeCompare(b.t.account_name, 'de'),
};

function CatText({ t }: { t: Transaction }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {t.transfer_id ? <><ArrowLeftRight size={12} aria-hidden />Umbuchung</>
        : t.split_count ? <><Split size={12} aria-hidden />Aufgeteilt</>
        : t.category_name ? <><Dot color={t.category_color} />{t.category_name}</>
        : <span className="text-warning">Ohne Kategorie</span>}
    </span>
  );
}

function Amount({ t, part }: Row) {
  return (
    <>
      <Money cents={part} colored={!t.transfer_id} className="font-medium" />
      {part !== t.amount && <div className="text-xs text-text-muted">von <Money cents={t.amount} colored={false} /></div>}
    </>
  );
}

/** Kompakte Liste (Fenster) oder breite Tabelle mit eigenen Spalten (Vollbild-Tab). */
function DrillList({ rows: raw, wide, limit }: { rows: Row[]; wide?: boolean; limit: number }) {
  const { openEdit } = useTxDialog();
  const [sort, setSort] = useState<Sort>('date');
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (r: Row) => terms.every((term) => [r.t.payee, r.t.purpose, r.t.note, r.t.category_name, r.t.account_name].some((v) => v?.toLowerCase().includes(term)));
    const out = raw.filter(hit).sort(sorters[sort]);
    return asc ? out.reverse() : out;
  }, [raw, sort, asc, q]);
  const sum = rows.reduce((a, r) => a + r.part, 0);
  const head = (k: Sort, label: string, cls = '') => (
    <th className={`py-2 px-2 font-medium ${cls}`} aria-sort={sort === k ? (asc ? 'ascending' : 'descending') : undefined}>
      <button className="hover:text-text" onClick={() => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(k === 'payee' || k === 'category' || k === 'account'); } }}>
        {label}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-sm">
        <input className={`input h-8 ${wide ? 'w-80' : 'w-56'}`} placeholder="In dieser Liste suchen" aria-label="In dieser Liste suchen" value={q} onChange={(e) => setQ(e.target.value)} />
        {!wide && (
          <div className="inline-flex rounded-md bg-surface-2 p-1">
            {([['date', 'nach Datum'], ['amount', 'nach Betrag']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={sort === k} onClick={() => { setSort(k); setAsc(false); }} className={`px-2.5 h-7 rounded text-xs ${sort === k ? 'bg-surface shadow-card font-medium' : 'text-text-muted'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 ? <p className="text-sm text-text-muted">Keine Buchungen.</p> : wide ? (
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-text-muted text-xs text-left sticky top-0">
            <tr>{head('date', 'Datum', 'w-28')}{head('payee', 'Empfänger / Zweck')}{head('category', 'Kategorie')}{head('account', 'Konto')}{head('amount', 'Betrag', 'text-right')}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, limit).map((r) => (
              <tr key={r.t.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => openEdit(r.t)} title="Buchung öffnen">
                <td className="py-2 px-2 tabular-nums text-text-muted whitespace-nowrap align-top">{formatDate(r.t.date)}</td>
                <td className="py-2 px-2 align-top">
                  <div className="font-medium">{r.t.payee || <span className="text-text-muted">–</span>}</div>
                  {(r.t.purpose || r.t.note) && <div className="text-xs text-text-muted">{[r.t.purpose, r.t.note].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="py-2 px-2 whitespace-nowrap align-top"><CatText t={r.t} /></td>
                <td className="py-2 px-2 whitespace-nowrap align-top text-text-muted">{r.t.account_name}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap align-top"><Amount {...r} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold border-t border-border">
              <td colSpan={4} className="py-2 px-2">Summe ({rows.length} {rows.length === 1 ? 'Buchung' : 'Buchungen'}){rows.length > limit ? `, Liste zeigt die ersten ${limit.toLocaleString('de-DE')}` : ''}</td>
              <td className="py-2 px-2 text-right whitespace-nowrap"><Money cents={sum} /></td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {rows.slice(0, limit).map((r) => (
              <tr key={r.t.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => openEdit(r.t)} title="Buchung öffnen">
                <td className="py-2 pr-2 tabular-nums text-text-muted whitespace-nowrap align-top">{formatDate(r.t.date)}</td>
                <td className="py-2 px-2 max-w-0 w-full">
                  <div className="truncate font-medium">{r.t.payee || <span className="text-text-muted">–</span>}</div>
                  {(r.t.purpose || r.t.note) && <div className="truncate text-xs text-text-muted">{[r.t.purpose, r.t.note].filter(Boolean).join(' · ')}</div>}
                  <div className="text-xs text-text-muted mt-0.5 inline-flex items-center gap-1.5"><CatText t={r.t} /><span>· {r.t.account_name}</span></div>
                </td>
                <td className="py-2 pl-2 text-right whitespace-nowrap align-top"><Amount {...r} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold border-t border-border">
              <td colSpan={2} className="py-2">Summe{rows.length > limit ? ` (Liste zeigt die ersten ${limit})` : ''}</td>
              <td className="py-2 text-right whitespace-nowrap"><Money cents={sum} /></td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  );
}

function DrillModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const rows = useDrillRows(drill.load, drill);
  const toTab = () => {
    openDrillTab({ title: drill.title, subtitle: drill.subtitle, parts: rows.map((r) => ({ id: r.t.id, amount: r.part })) });
    onClose();
  };
  return (
    <Modal title={drill.title} onClose={onClose} wide footer={
      <>
        <button className="btn-secondary mr-auto" onClick={toTab} disabled={!rows.length} title="Liste in einem neuen Browser-Tab mit voller Breite öffnen">
          <ExternalLink size={16} />In neuem Tab öffnen
        </button>
        {drill.link && <Link className="btn-secondary" to={drill.link} onClick={onClose}>In der Buchungsliste öffnen</Link>}
        <button className="btn-primary" onClick={onClose}>Schließen</button>
      </>
    }>
      <p className="text-sm text-text-muted mb-2">{drill.subtitle ? `${drill.subtitle} · ` : ''}{rows.length} {rows.length === 1 ? 'Buchung' : 'Buchungen'}</p>
      <DrillList rows={rows} limit={500} />
    </Modal>
  );
}

/** Seite für den neuen Tab: dieselbe Liste über die ganze Bildschirmbreite, ohne Menü. */
export function DrillPage() {
  const { id = '' } = useParams();
  const spec = useMemo(() => readTabDrill(id), [id]);
  const rows = useDrillRows(() => spec?.parts ?? [], spec);
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    if (spec) document.title = `${spec.title} – Haushaltskompass`;
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [spec]);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  if (!spec) {
    return (
      <div className="card p-6 max-w-lg">
        <h1 className="text-lg font-semibold mb-2">Diese Auswahl gibt es nicht mehr</h1>
        <p className="text-sm text-text-muted mb-4">Öffne die Buchungen in den Auswertungen erneut und wähle „In neuem Tab öffnen“.</p>
        <Link className="btn-primary" to="/auswertungen">Zu den Auswertungen</Link>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{spec.title}</h1>
          <p className="text-sm text-text-muted">{spec.subtitle ? `${spec.subtitle} · ` : ''}Stand der Auswahl: {new Date(spec.created).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <button className="btn-secondary" onClick={toggleFull}>{full ? <><Minimize2 size={16} />Vollbild beenden</> : <><Maximize2 size={16} />Vollbild</>}</button>
          <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} />Drucken / PDF</button>
          <button className="btn-secondary" onClick={() => { window.close(); }} title="Tab schließen"><X size={16} />Schließen</button>
        </div>
      </div>
      <div className="card p-4"><DrillList rows={rows} wide limit={5000} /></div>
      <p className="text-xs text-text-muted mt-2 no-print">Ein Klick auf eine Buchung öffnet sie zum Bearbeiten. Änderungen erscheinen sofort auch im anderen Tab.</p>
    </>
  );
}

/** Schaltfläche in einer Tabellenzelle, die die zugehörigen Buchungen öffnet. */
export function DrillCell({ onClick, children, label, className = '' }: { onClick: () => void; children: React.ReactNode; label?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} title={label ?? 'Buchungen anzeigen'}
      className={`rounded px-1 -mx-1 hover:bg-accent-soft hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${className}`}>
      {children}
    </button>
  );
}
