import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Split } from 'lucide-react';
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

function DrillModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const { openEdit } = useTxDialog();
  const [sort, setSort] = useState<'date' | 'amount'>('date');
  // läuft bei jeder Änderung im Haushaltsbuch neu, damit eine geänderte Buchung sofort richtig einsortiert ist
  const data = useQuery((b) => {
    const parts = drill.load(b);
    const txs = parts.length ? listTransactions(b, { ids: parts.map((p) => p.id) }) : [];
    const share = new Map(parts.map((p) => [p.id, p.amount]));
    return txs.map((t) => ({ t, part: share.get(t.id) ?? t.amount }));
  }, [drill]);
  const rows = useMemo(() => [...data].sort((a, b) => (sort === 'amount' ? Math.abs(b.part) - Math.abs(a.part) : b.t.date.localeCompare(a.t.date))), [data, sort]);
  const sum = rows.reduce((a, r) => a + r.part, 0);
  return (
    <Modal title={drill.title} onClose={onClose} wide footer={
      <>
        {drill.link && <Link className="btn-secondary mr-auto" to={drill.link} onClick={onClose}>In der Buchungsliste öffnen</Link>}
        <button className="btn-primary" onClick={onClose}>Schließen</button>
      </>
    }>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-sm">
        <span className="text-text-muted">{drill.subtitle ? `${drill.subtitle} · ` : ''}{rows.length} {rows.length === 1 ? 'Buchung' : 'Buchungen'}</span>
        <div className="inline-flex rounded-md bg-surface-2 p-1">
          {([['date', 'nach Datum'], ['amount', 'nach Betrag']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)} className={`px-2.5 h-7 rounded text-xs ${sort === k ? 'bg-surface shadow-card font-medium' : 'text-text-muted'}`}>{l}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-text-muted">Keine Buchungen.</p> : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {rows.slice(0, 500).map(({ t, part }) => (
              <tr key={t.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => openEdit(t)} title="Buchung öffnen">
                <td className="py-2 pr-2 tabular-nums text-text-muted whitespace-nowrap align-top">{formatDate(t.date)}</td>
                <td className="py-2 px-2 max-w-0 w-full">
                  <div className="truncate font-medium">{t.payee || <span className="text-text-muted">–</span>}</div>
                  {(t.purpose || t.note) && <div className="truncate text-xs text-text-muted">{[t.purpose, t.note].filter(Boolean).join(' · ')}</div>}
                  <div className="text-xs text-text-muted mt-0.5 inline-flex items-center gap-1.5">
                    {t.transfer_id ? <><ArrowLeftRight size={12} aria-hidden />Umbuchung</>
                      : t.split_count ? <><Split size={12} aria-hidden />Aufgeteilt</>
                      : t.category_name ? <><Dot color={t.category_color} />{t.category_name}</>
                      : <span className="text-warning">Ohne Kategorie</span>}
                    <span>· {t.account_name}</span>
                  </div>
                </td>
                <td className="py-2 pl-2 text-right whitespace-nowrap align-top">
                  <Money cents={part} colored={!t.transfer_id} className="font-medium" />
                  {part !== t.amount && <div className="text-xs text-text-muted">von <Money cents={t.amount} colored={false} /></div>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold border-t border-border">
              <td colSpan={2} className="py-2">Summe{rows.length > 500 ? ' (Liste zeigt die ersten 500)' : ''}</td>
              <td className="py-2 text-right whitespace-nowrap"><Money cents={sum} /></td>
            </tr>
          </tfoot>
        </table>
      )}
    </Modal>
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
