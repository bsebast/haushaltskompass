import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Printer, Bookmark, X, ChevronRight, ChevronDown } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Dot, ErrorNote } from '../components/ui';
import CategorySelect from '../components/CategorySelect';
import { CashflowChart, FixVarChart, StackedAreaChart, DonutChart, SERIES } from '../components/charts';
import { listAccounts, listCategories } from '../db/repo';
import {
  reportLines, periodsBetween, periodLabel, cashflow, sumCashflow, pivot, compareByRoot, shiftYear, topPayees,
  contractsPlanVsActual, wealthSeries, accountAudit, listViews, saveView, deleteView,
  type Granularity, type ReportFilter, type WealthGroup,
} from '../db/analytics';
import { ACCOUNT_TYPES } from '../db/types';
import { today, monthRange, currentMonth, addMonths, formatDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { download } from '../lib/csvExport';

/* ---------- Zustand in der Adresszeile (teilbar, speicherbar) ---------- */

type Tab = 'ueberblick' | 'kategorien' | 'fixkosten' | 'vorjahr' | 'empfaenger' | 'vermoegen' | 'abgleich';
const TABS: [Tab, string][] = [
  ['ueberblick', 'Überblick'], ['kategorien', 'Kategorien × Zeit'], ['fixkosten', 'Fix & variabel'], ['vorjahr', 'Vorjahresvergleich'],
  ['empfaenger', 'Empfänger'], ['vermoegen', 'Vermögen'], ['abgleich', 'Kontoabgleich'],
];

type Preset = 'monat' | 'vormonat' | 'jahr' | 'vorjahr' | '12m' | 'quartal' | 'alles' | 'frei';
const PRESETS: [Preset, string][] = [
  ['monat', 'Dieser Monat'], ['vormonat', 'Letzter Monat'], ['quartal', 'Letzte 3 Monate'], ['jahr', 'Dieses Jahr'],
  ['vorjahr', 'Letztes Jahr'], ['12m', 'Letzte 12 Monate'], ['alles', 'Alles'], ['frei', 'Eigener Zeitraum'],
];

function presetRange(p: Preset, first: string): { from: string; to: string } {
  const m = currentMonth();
  const y = Number(m.slice(0, 4));
  switch (p) {
    case 'monat': return monthRange(m);
    case 'vormonat': return monthRange(addMonths(m, -1));
    case 'quartal': return { from: monthRange(addMonths(m, -2)).from, to: today() };
    case 'jahr': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'vorjahr': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case '12m': return { from: monthRange(addMonths(m, -11)).from, to: monthRange(m).to };
    default: return { from: first, to: today() };
  }
}

function useReportState() {
  const [params, setParams] = useSearchParams();
  const first = useQuery((b) => b.value<string>('select min(date) from transactions') ?? `${currentMonth().slice(0, 4)}-01-01`);
  const tab = (params.get('ansicht') as Tab) ?? 'ueberblick';
  const preset = (params.get('zeitraum') as Preset) ?? 'jahr';
  const range = preset === 'frei' ? { from: params.get('von') ?? presetRange('jahr', first).from, to: params.get('bis') ?? today() } : presetRange(preset, first);
  const g = (params.get('einteilung') as Granularity) ?? 'month';
  const list = (k: string) => (params.get(k) ? params.get(k)!.split(',') : []);
  const filter: ReportFilter = {
    ...range, accountIds: list('konten'), owners: list('person').map((o) => (o === '-' ? '' : o)),
    categoryId: params.get('kategorie'), search: params.get('suche') ?? '', savingsAsSaving: params.get('sparen') !== 'aus',
    hideUncategorized: params.get('offen') === 'aus',
  };
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: true });
  };
  return { params, setParams, tab, preset, g, filter, set };
}

/* ---------- Export der jeweils sichtbaren Tabelle ---------- */

interface Table { name: string; head: string[]; rows: (string | number)[][] }
const ExportCtx = createContext<(t: Table | null) => void>(() => {});
function useExportTable(t: Table | null) {
  const set = useContext(ExportCtx);
  const key = JSON.stringify(t);
  useEffect(() => { set(t); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');
function toCsv(t: Table) {
  const cell = (v: string | number) => { const s = String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [t.head, ...t.rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

/* ---------- Seite ---------- */

export default function Reports() {
  const s = useReportState();
  const table = useRef<Table | null>(null);
  const setTable = (t: Table | null) => { table.current = t; };
  const label = `${formatDate(s.filter.from)} – ${formatDate(s.filter.to)}`;
  return (
    <ExportCtx.Provider value={setTable}>
      <PageHeader title="Auswertungen" subtitle={label} actions={
        <div className="flex flex-wrap gap-2 no-print">
          <button className="btn-secondary" onClick={() => table.current && download(`auswertung-${table.current.name}-${today()}.csv`, toCsv(table.current), 'text/csv;charset=utf-8')}>
            <Download size={16} />CSV
          </button>
          <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} />Drucken / PDF</button>
        </div>
      } />
      <Views state={s} />
      <FilterBar state={s} />
      <div role="tablist" className="flex gap-1 rounded-md bg-surface-2 p-1 mb-4 overflow-x-auto no-print">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={s.tab === k} onClick={() => s.set({ ansicht: k === 'ueberblick' ? null : k })}
            className={`px-3 h-8 rounded text-sm font-medium whitespace-nowrap ${s.tab === k ? 'bg-surface shadow-card' : 'text-text-muted'}`}>{l}</button>
        ))}
      </div>
      <h2 className="print-only text-lg font-semibold mb-2">{TABS.find(([k]) => k === s.tab)?.[1]}</h2>
      {s.tab === 'ueberblick' && <Overview f={s.filter} g={s.g} />}
      {s.tab === 'kategorien' && <PivotView f={s.filter} g={s.g} />}
      {s.tab === 'fixkosten' && <FixedView f={s.filter} g={s.g} />}
      {s.tab === 'vorjahr' && <YearCompare f={s.filter} />}
      {s.tab === 'empfaenger' && <Payees f={s.filter} />}
      {s.tab === 'vermoegen' && <Wealth f={s.filter} g={s.g} />}
      {s.tab === 'abgleich' && <Audit f={s.filter} />}
    </ExportCtx.Provider>
  );
}

function Views({ state }: { state: ReturnType<typeof useReportState> }) {
  const book = useBook();
  const views = useQuery(listViews);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = state.params.toString();
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 no-print">
      {views.map((v) => (
        <span key={v.name} className={`inline-flex items-center rounded-full border text-sm ${v.query === current ? 'border-accent bg-accent-soft' : 'border-border bg-surface'}`}>
          <button className="pl-3 pr-1 h-8" onClick={() => state.setParams(new URLSearchParams(v.query), { replace: true })}>{v.name}</button>
          <button className="pr-2 h-8 text-text-muted hover:text-danger" aria-label={`Ansicht ${v.name} löschen`} onClick={() => deleteView(book, v.name)}><X size={14} /></button>
        </span>
      ))}
      {name === null ? (
        <button className="btn-ghost h-8" onClick={() => setName('')}><Bookmark size={16} />Ansicht speichern</button>
      ) : (
        <form className="flex items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          try { saveView(book, { name, query: current }); setName(null); setError(null); } catch (err) { setError((err as Error).message); }
        }}>
          <input className="input h-8 w-56" autoFocus placeholder="Name, z. B. Lebensmittel 2026" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name der Ansicht" />
          <button className="btn-primary h-8">Speichern</button>
          <button type="button" className="btn-ghost h-8" onClick={() => setName(null)}>Abbrechen</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function FilterBar({ state }: { state: ReturnType<typeof useReportState> }) {
  const { filter: f, preset, g, set } = state;
  const accounts = useQuery((b) => listAccounts(b, true));
  const owners = useMemo(() => [...new Set(accounts.map((a) => a.owner ?? ''))].sort(), [accounts]);
  const [q, setQ] = useState(f.search ?? '');
  useEffect(() => { const t = setTimeout(() => q !== (f.search ?? '') && set({ suche: q || null }), 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleAccount = (id: string) => {
    const cur = new Set(f.accountIds);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    set({ konten: [...cur].join(',') || null });
  };
  const ownerParam = (f.owners ?? []).map((o) => o || '-');
  const active = (f.accountIds?.length ?? 0) + (f.owners?.length ?? 0) + (f.categoryId ? 1 : 0) + (f.search ? 1 : 0);
  return (
    <div className="card p-3 mb-4 no-print">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[170px_auto_150px_170px_1fr]">
        <select className="input" aria-label="Zeitraum" value={preset} onChange={(e) => {
          const p = e.target.value as Preset;
          set(p === 'frei' ? { zeitraum: p, von: f.from, bis: f.to } : { zeitraum: p === 'jahr' ? null : p, von: null, bis: null });
        }}>
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" className="input" aria-label="Von" value={f.from} onChange={(e) => e.target.value && set({ zeitraum: 'frei', von: e.target.value, bis: f.to })} />
          <span className="text-text-muted">–</span>
          <input type="date" className="input" aria-label="Bis" value={f.to} onChange={(e) => e.target.value && set({ zeitraum: 'frei', von: f.from, bis: e.target.value })} />
        </div>
        <select className="input" aria-label="Einteilung" value={g} onChange={(e) => set({ einteilung: e.target.value === 'month' ? null : e.target.value })}>
          <option value="month">je Monat</option><option value="quarter">je Quartal</option><option value="year">je Jahr</option>
        </select>
        <CategorySelect value={f.categoryId ?? null} onChange={(c) => set({ kategorie: c })} emptyLabel="Alle Kategorien" ariaLabel="Kategorie" />
        <input className="input" placeholder="Suche in Empfänger, Zweck, Notiz" aria-label="Suche" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-text-muted mr-1">Person:</span>
          {owners.map((o) => {
            const on = ownerParam.includes(o || '-');
            return (
              <button key={o || '-'} aria-pressed={on} onClick={() => set({ person: (on ? ownerParam.filter((x) => x !== (o || '-')) : [...ownerParam, o || '-']).join(',') || null })}
                className={`px-2.5 h-7 rounded-full border text-xs ${on ? 'border-accent bg-accent-soft font-medium' : 'border-border'}`}>{o || 'Ohne Inhaber'}</button>
            );
          })}
        </div>
        <details className="relative">
          <summary className="cursor-pointer text-accent">{f.accountIds?.length ? `${f.accountIds.length} Konten gewählt` : 'Alle Konten'}</summary>
          <div className="absolute z-30 mt-1 card p-2 max-h-72 overflow-auto w-72 space-y-1">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!f.accountIds?.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                <span className="truncate">{a.name}{a.owner ? ` · ${a.owner}` : ''}{a.archived ? ' (archiviert)' : ''}</span>
              </label>
            ))}
          </div>
        </details>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={f.savingsAsSaving !== false} onChange={(e) => set({ sparen: e.target.checked ? null : 'aus' })} />
          Sparen getrennt von Ausgaben
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={!!f.hideUncategorized} onChange={(e) => set({ offen: e.target.checked ? 'aus' : null })} />
          Buchungen ohne Kategorie ausblenden
        </label>
        {active > 0 && <button className="text-accent hover:underline" onClick={() => { setQ(''); set({ konten: null, person: null, kategorie: null, suche: null }); }}>Filter zurücksetzen</button>}
      </div>
    </div>
  );
}

/* ---------- Überblick: Cashflow und Sparquote ---------- */

function Kpi({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="card p-4"><div className="text-xs text-text-muted">{label}</div><div className="text-xl font-semibold mt-1">{children}</div>{hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}</div>;
}
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);

function Overview({ f, g }: { f: ReportFilter; g: Granularity }) {
  const lines = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const periods = periodsBetween(f.from, f.to, g);
  const rows = cashflow(lines, periods, g);
  const sum = sumCashflow(rows);
  const open = lines.filter((l) => !l.category_id);
  const openSum = open.reduce((a, l) => a + Math.abs(l.amount), 0);
  const months = Math.max(1, periodsBetween(f.from, f.to, 'month').length);
  useExportTable({
    name: 'cashflow', head: ['Zeitraum', 'Einnahmen', 'Ausgaben', 'davon fix', 'Sparen', 'Rest', 'Sparquote'],
    rows: [...rows, sum].map((r) => [r.period === 'Summe' ? 'Summe' : periodLabel(r.period), eur(r.income), eur(r.expense), eur(r.fixed), eur(r.saving), eur(r.net), pct(r.rate)]),
  });
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Kpi label="Einnahmen" hint={`Ø ${formatCents(Math.round(sum.income / months))} im Monat`}><Money cents={sum.income} /></Kpi>
        <Kpi label="Ausgaben" hint={`Ø ${formatCents(Math.round(sum.expense / months))} im Monat`}><Money cents={-sum.expense} /></Kpi>
        <Kpi label="Gespart (Sparen & Anlegen)"><Money cents={sum.saving} colored={false} /></Kpi>
        <Kpi label="Rest nach Sparen" hint="Einnahmen − Ausgaben − Gespartes"><Money cents={sum.net} /></Kpi>
        <Kpi label="Sparquote" hint="(Gespartes + Rest) ÷ Einnahmen">{pct(sum.rate)}</Kpi>
      </div>
      {open.length > 0 && !f.hideUncategorized && (
        <p className="text-sm mb-4 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          {open.length} Buchungen ({formatCents(openSum)}) haben noch keine Kategorie, oft Überweisungen zwischen eigenen Konten.
          {' '}<Link className="text-accent hover:underline" to="/buchungen?zeitraum=all">Zuordnen oder als Umbuchung erfassen</Link>, damit Ausgaben und Sparquote stimmen.
        </p>
      )}
      <section className="card p-4 mb-4"><h3 className="text-sm font-semibold mb-3">Einnahmen, Ausgaben und Sparen</h3><CashflowChart data={rows} /></section>
      <div className="grid gap-4 xl:grid-cols-2 mb-4">
        <Breakdown f={f} kind="expense" />
        <Breakdown f={f} kind="income" />
      </div>
      <section className="card p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Zeitraum</th><th className="text-right">Einnahmen</th><th className="text-right">Ausgaben</th><th className="text-right">Sparen</th><th className="text-right">Rest</th><th className="text-right">Sparquote</th></tr></thead>
          <tbody className="divide-y divide-border">
            {[...rows, sum].map((r) => (
              <tr key={r.period} className={r.period === 'Summe' ? 'font-semibold' : ''}>
                <td className="py-1.5">{r.period === 'Summe' ? 'Summe' : periodLabel(r.period)}</td>
                <td className="text-right"><Money cents={r.income} /></td><td className="text-right"><Money cents={-r.expense} /></td>
                <td className="text-right"><Money cents={r.saving} colored={false} /></td><td className="text-right"><Money cents={r.net} /></td>
                <td className="text-right">{pct(r.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Breakdown({ f, kind }: { f: ReportFilter; kind: 'expense' | 'income' }) {
  const lines = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const cats = useQuery(listCategories);
  const rows = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const l of lines) if ((kind === 'income') === (l.amount > 0)) m.set(l.root_id, (m.get(l.root_id) ?? 0) + Math.abs(l.amount));
    const total = [...m.values()].reduce((a, v) => a + v, 0) || 1;
    return [...m.entries()].map(([id, amount]) => {
      const c = cats.find((x) => x.id === id);
      return { id, name: c?.name ?? 'Ohne Kategorie', color: c?.color ?? '#8a8478', amount, share: amount / total };
    }).sort((a, b) => b.amount - a.amount);
  }, [lines, cats, kind]);
  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold mb-3">{kind === 'expense' ? 'Ausgaben' : 'Einnahmen'} nach Kategorie</h3>
      {rows.length === 0 ? <p className="text-sm text-text-muted">Keine Daten in diesem Zeitraum.</p> : (
        <div className="grid sm:grid-cols-[180px_1fr] gap-4 items-center">
          <DonutChart data={rows.slice(0, 10)} height={180} />
          <table className="w-full text-sm"><tbody className="divide-y divide-border">
            {rows.slice(0, 10).map((r) => (
              <tr key={r.id ?? 'none'}>
                <td className="py-1"><span className="inline-flex items-center gap-2"><Dot color={r.color} />{r.name}</span></td>
                <td className="py-1 text-right text-xs text-text-muted w-12">{Math.round(r.share * 100)} %</td>
                <td className="py-1 text-right w-28"><Money cents={r.amount} colored={false} /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </section>
  );
}

/* ---------- Kategorien × Zeit ---------- */

function PivotView({ f, g }: { f: ReportFilter; g: Granularity }) {
  const book = useBook();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lines = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const periods = periodsBetween(f.from, f.to, g);
  const rows = useMemo(() => pivot(book, lines, periods, g, kind, expanded), [book, lines, periods.join(), g, kind, expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = rows.filter((r) => r.depth === 0);
  const totals = periods.map((_, i) => top.reduce((a, r) => a + r.cells[i], 0));
  const grand = totals.reduce((a, v) => a + v, 0);
  const max = Math.max(1, ...rows.filter((r) => r.depth === 0 || !r.hasChildren).flatMap((r) => r.cells));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  useExportTable({
    name: 'kategorien', head: ['Kategorie', ...periods.map(periodLabel), 'Summe', 'Durchschnitt'],
    rows: [...rows.map((r) => [`${'  '.repeat(r.depth)}${r.name}`, ...r.cells.map(eur), eur(r.total), eur(r.avg)]), ['Summe', ...totals.map(eur), eur(grand), eur(Math.round(grand / periods.length))]],
  });
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3 no-print">
        <div className="inline-flex rounded-md bg-surface-2 p-1">
          {(['expense', 'income'] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={`px-3 h-7 rounded text-sm ${kind === k ? 'bg-surface shadow-card font-medium' : 'text-text-muted'}`}>{k === 'expense' ? 'Ausgaben' : 'Einnahmen'}</button>
          ))}
        </div>
        <button className="text-sm text-accent hover:underline" onClick={() => setExpanded(new Set(rows.filter((r) => r.hasChildren && r.id).map((r) => r.id!)))}>Alle aufklappen</button>
        <button className="text-sm text-accent hover:underline" onClick={() => setExpanded(new Set())}>Alle zuklappen</button>
        <span className="text-xs text-text-muted">Je dunkler das Feld, desto höher der Betrag. Sparen zählt hier zu den Ausgaben.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead className="text-xs text-text-muted">
            <tr>
              <th className="text-left py-1 pr-3 sticky left-0 bg-surface min-w-[200px]">Kategorie</th>
              {periods.map((p) => <th key={p} className="text-right px-2 whitespace-nowrap">{periodLabel(p)}</th>)}
              <th className="text-right px-2">Summe</th><th className="text-right pl-2">Ø</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={`${r.id}-${r.depth}`} className={r.depth === 0 ? 'font-medium' : ''}>
                <td className="py-1.5 pr-3 sticky left-0 bg-surface whitespace-nowrap" style={{ paddingLeft: r.depth * 18 }}>
                  <span className="inline-flex items-center gap-1.5">
                    {r.hasChildren && r.id ? (
                      <button aria-expanded={expanded.has(r.id)} aria-label={`${r.name} aufklappen`} onClick={() => toggle(r.id!)} className="text-text-muted">
                        {expanded.has(r.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : <span className="w-[14px]" />}
                    <Dot color={r.color} />
                    {r.id && !r.id.includes('#') ? <Link className="hover:underline" to={`/buchungen?kategorie=${r.id}`}>{r.name}</Link> : r.name}
                  </span>
                </td>
                {r.cells.map((v, i) => (
                  <td key={i} className="text-right px-2 tabular-nums whitespace-nowrap"
                    style={v && (!r.hasChildren || !expanded.has(r.id ?? '')) ? { background: `rgb(var(--c-accent) / ${(0.06 + 0.34 * (v / max)).toFixed(2)})` } : undefined}
                    title={`${r.name}, ${periodLabel(periods[i])}: ${formatCents(v)}`}>
                    {v ? formatCents(v).replace(/,\d\d\s€$/, ' €') : <span className="text-text-muted">–</span>}
                  </td>
                ))}
                <td className="text-right px-2 tabular-nums whitespace-nowrap"><Money cents={r.total} colored={false} /></td>
                <td className="text-right pl-2 tabular-nums whitespace-nowrap text-text-muted">{formatCents(r.avg)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 sticky left-0 bg-surface">Summe</td>
              {totals.map((v, i) => <td key={i} className="text-right px-2 tabular-nums whitespace-nowrap">{formatCents(v).replace(/,\d\d\s€$/, ' €')}</td>)}
              <td className="text-right px-2 whitespace-nowrap"><Money cents={grand} colored={false} /></td>
              <td className="text-right pl-2 whitespace-nowrap">{formatCents(Math.round(grand / periods.length))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Fixkosten gegen variable Ausgaben ---------- */

function FixedView({ f, g }: { f: ReportFilter; g: Granularity }) {
  const lines = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const contracts = useQuery((b) => contractsPlanVsActual(b, f), [JSON.stringify(f)]);
  const periods = periodsBetween(f.from, f.to, g);
  const rows = cashflow(lines, periods, g);
  const sum = sumCashflow(rows);
  const plannedSum = contracts.reduce((a, c) => a + c.planned, 0);
  const actualSum = contracts.reduce((a, c) => a + c.actual, 0);
  useExportTable({
    name: 'vertraege', head: ['Vertrag', 'Geplant im Zeitraum', 'Gebucht', 'Anzahl Buchungen', 'Differenz'],
    rows: contracts.map((c) => [c.name, eur(c.planned), eur(c.actual), c.count, eur(c.actual - c.planned)]),
  });
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Fixkosten (Buchungen mit Vertrag)"><Money cents={-sum.fixed} /></Kpi>
        <Kpi label="Variable Ausgaben"><Money cents={-sum.variable} /></Kpi>
        <Kpi label="Fixkostenquote" hint="Fixkosten im Verhältnis zu den Einnahmen">{sum.income ? pct(sum.fixed / sum.income) : '–'}</Kpi>
        <Kpi label="Verträge: geplant / gebucht" hint="bis heute, inkl. Sparverträge"><span className="text-base">{formatCents(plannedSum)} / {formatCents(actualSum)}</span></Kpi>
      </div>
      <section className="card p-4 mb-4"><h3 className="text-sm font-semibold mb-3">Fixkosten und variable Ausgaben</h3><FixVarChart data={rows} /></section>
      <section className="card p-4 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-1">Verträge: geplant gegen tatsächlich gebucht</h3>
        <p className="text-xs text-text-muted mb-3">Geplant ist der Monatsbetrag des Vertrags mal die Monate im Zeitraum. Weicht der gebuchte Betrag stark ab, hat sich der Beitrag geändert, die Buchung ist keinem Vertrag zugeordnet, oder sie läuft über ein anderes Konto.</p>
        <table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Vertrag</th><th className="text-right">Geplant</th><th className="text-right">Gebucht</th><th className="text-right">Buchungen</th><th className="text-right">Differenz</th></tr></thead>
          <tbody className="divide-y divide-border">
            {contracts.map((c) => {
              const d = c.actual - c.planned;
              const off = c.planned && Math.abs(d) > c.planned * 0.1;
              return (
                <tr key={c.id}>
                  <td className="py-1.5">{c.name}</td>
                  <td className="text-right"><Money cents={c.planned} colored={false} /></td>
                  <td className="text-right">{c.count ? <Money cents={c.actual} colored={false} /> : <span className="text-text-muted">keine Buchung</span>}</td>
                  <td className="text-right text-text-muted">{c.count || ''}</td>
                  <td className={`text-right ${off ? 'text-warning font-medium' : 'text-text-muted'}`}>{d > 0 ? '+' : ''}{formatCents(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

/* ---------- Vorjahresvergleich ---------- */

function YearCompare({ f }: { f: ReportFilter }) {
  const book = useBook();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const prevF = { ...f, from: shiftYear(f.from, -1), to: shiftYear(f.to, -1) };
  const cur = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const prev = useQuery((b) => reportLines(b, prevF), [JSON.stringify(prevF)]);
  const rows = useMemo(() => compareByRoot(book, cur, prev, kind), [book, cur, prev, kind]);
  const sa = rows.reduce((a, r) => a + r.previous, 0);
  const sb = rows.reduce((a, r) => a + r.current, 0);
  const maxV = Math.max(1, ...rows.flatMap((r) => [r.current, r.previous]));
  const lp = `${formatDate(prevF.from)} – ${formatDate(prevF.to)}`;
  const lc = `${formatDate(f.from)} – ${formatDate(f.to)}`;
  useExportTable({
    name: 'vorjahr', head: ['Kategorie', lp, lc, 'Differenz', 'Veränderung'],
    rows: rows.map((r) => [r.name, eur(r.previous), eur(r.current), eur(r.diff), r.pct === null ? '' : pct(r.pct)]),
  });
  return (
    <section className="card p-4 overflow-x-auto">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="inline-flex rounded-md bg-surface-2 p-1 no-print">
          {(['expense', 'income'] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={`px-3 h-7 rounded text-sm ${kind === k ? 'bg-surface shadow-card font-medium' : 'text-text-muted'}`}>{k === 'expense' ? 'Ausgaben' : 'Einnahmen'}</button>
          ))}
        </div>
        <span className="text-sm text-text-muted">Gewählter Zeitraum gegen denselben Zeitraum ein Jahr früher. Sortiert nach der größten Veränderung.</span>
      </div>
      {sa === 0 && <p className="text-sm text-warning mb-3">Für {lp} gibt es keine Buchungen. Der Vergleich wird aussagekräftig, sobald Buchungen aus dem Vorjahr erfasst oder importiert sind.</p>}
      <table className="w-full text-sm min-w-[680px]">
        <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Kategorie</th><th className="text-right">{lp}</th><th className="text-right">{lc}</th><th className="w-40"><span className="sr-only">Balken</span></th><th className="text-right">Differenz</th><th className="text-right">%</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const worse = kind === 'expense' ? r.diff > 0 : r.diff < 0;
            return (
              <tr key={r.id ?? 'none'}>
                <td className="py-1.5"><span className="inline-flex items-center gap-2"><Dot color={r.color} />{r.name}</span></td>
                <td className="text-right"><Money cents={r.previous} colored={false} /></td>
                <td className="text-right"><Money cents={r.current} colored={false} /></td>
                <td className="px-3" aria-hidden>
                  <div className="h-1.5 rounded-full bg-text-muted/30 mb-0.5" style={{ width: `${(r.previous / maxV) * 100}%` }} />
                  <div className="h-1.5 rounded-full" style={{ width: `${(r.current / maxV) * 100}%`, background: r.color }} />
                </td>
                <td className={`text-right font-medium ${r.diff === 0 ? '' : worse ? 'text-expense' : 'text-income'}`}>{r.diff > 0 ? '+' : ''}{formatCents(r.diff)}</td>
                <td className="text-right text-text-muted">{r.pct === null ? 'neu' : `${r.pct > 0 ? '+' : ''}${Math.round(r.pct * 100)} %`}</td>
              </tr>
            );
          })}
          <tr className="font-semibold"><td className="py-1.5">Summe</td><td className="text-right"><Money cents={sa} colored={false} /></td><td className="text-right"><Money cents={sb} colored={false} /></td><td /><td className="text-right">{sb - sa > 0 ? '+' : ''}{formatCents(sb - sa)}</td><td className="text-right text-text-muted">{sa ? `${Math.round(((sb - sa) / sa) * 100)} %` : ''}</td></tr>
        </tbody>
      </table>
      <p className="text-xs text-text-muted mt-2">Grauer Balken: Vorjahr, farbiger Balken: gewählter Zeitraum.</p>
    </section>
  );
}

/* ---------- Empfänger ---------- */

function Payees({ f }: { f: ReportFilter }) {
  const lines = useQuery((b) => reportLines(b, f), [JSON.stringify(f)]);
  const rows = useMemo(() => topPayees(lines, 100), [lines]);
  useExportTable({ name: 'empfaenger', head: ['Empfänger', 'Buchungen', 'Ausgaben', 'Einnahmen', 'Zuletzt'], rows: rows.map((r) => [r.payee, r.count, eur(r.expense), eur(r.income), formatDate(r.last)]) });
  const max = Math.max(1, ...rows.map((r) => r.expense));
  return (
    <section className="card p-4 overflow-x-auto">
      <p className="text-sm text-text-muted mb-3">Die 100 Empfänger und Auftraggeber mit den höchsten Beträgen im Zeitraum.</p>
      <table className="w-full text-sm min-w-[640px]">
        <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Empfänger / Auftraggeber</th><th className="text-right">Buchungen</th><th className="text-right">Ausgaben</th><th className="w-32"><span className="sr-only">Anteil</span></th><th className="text-right">Einnahmen</th><th className="text-right">Zuletzt</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.payee}>
              <td className="py-1.5"><Link className="hover:underline" to={`/buchungen?suche=${encodeURIComponent(r.payee)}`}>{r.payee}</Link></td>
              <td className="text-right text-text-muted">{r.count}</td>
              <td className="text-right">{r.expense ? <Money cents={-r.expense} /> : ''}</td>
              <td className="px-3" aria-hidden><div className="h-1.5 rounded-full bg-expense/70" style={{ width: `${(r.expense / max) * 100}%` }} /></td>
              <td className="text-right">{r.income ? <Money cents={r.income} /> : ''}</td>
              <td className="text-right text-text-muted whitespace-nowrap">{formatDate(r.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------- Vermögen ---------- */

function Wealth({ f, g }: { f: ReportFilter; g: Granularity }) {
  const [group, setGroup] = useState<WealthGroup>('type');
  const data = useQuery((b) => wealthSeries(b, f, g, group, { type: ACCOUNT_TYPES }), [JSON.stringify(f), g, group]);
  // höchstens 7 eigene Serien, der Rest wird zu „Weitere“
  const { keys, rows } = useMemo(() => {
    const last = data.rows[data.rows.length - 1] ?? {};
    const sorted = [...data.keys].sort((a, b) => Math.abs(Number(last[b] ?? 0)) - Math.abs(Number(last[a] ?? 0)));
    if (sorted.length <= SERIES.length) return { keys: sorted, rows: data.rows };
    const keep = sorted.slice(0, SERIES.length - 1);
    const rest = sorted.slice(SERIES.length - 1);
    return {
      keys: [...keep, 'Weitere'],
      rows: data.rows.map((r): Record<string, number | string> => ({ ...Object.fromEntries(keep.map((k) => [k, r[k]])), period: r.period, total: r.total, Weitere: rest.reduce((s, k) => s + Number(r[k] ?? 0), 0) })),
    };
  }, [data]);
  const first = Number(rows[0]?.total ?? 0);
  const last = Number(rows[rows.length - 1]?.total ?? 0);
  useExportTable({ name: 'vermoegen', head: ['Zeitraum', ...keys, 'Gesamt'], rows: rows.map((r) => [periodLabel(String(r.period)), ...keys.map((k) => eur(Number(r[k] ?? 0))), eur(Number(r.total))]) });
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={`Stand ${rows[0] ? periodLabel(String(rows[0].period)) : ''}`}><Money cents={first} colored={false} /></Kpi>
        <Kpi label={`Stand ${rows.length ? periodLabel(String(rows[rows.length - 1].period)) : ''}`}><Money cents={last} colored={false} /></Kpi>
        <Kpi label="Veränderung"><Money cents={last - first} /></Kpi>
        <Kpi label="Depotpositionen (Kurswert)" hint={`${data.depotAsOf ? `Stand ${formatDate(data.depotAsOf)}. ` : ''}Zum Vergleich mit den Depotkonten, nicht zusätzlich gezählt`}><Money cents={data.depotValue} colored={false} /></Kpi>
      </div>
      <section className="card p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold">Kontostände am Ende jedes Zeitraums</h3>
          <select className="input w-48 no-print" value={group} onChange={(e) => setGroup(e.target.value as WealthGroup)} aria-label="Gruppieren nach">
            <option value="type">nach Kontoart</option><option value="owner">nach Person</option><option value="account">nach Konto</option>
          </select>
        </div>
        <StackedAreaChart data={rows} keys={keys} />
        <p className="text-xs text-text-muted mt-2">Kredite zählen negativ. Grundlage sind die erfassten Kontostände und die Buchungen danach.</p>
      </section>
      <section className="card p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Zeitraum</th>{keys.map((k) => <th key={k} className="text-right px-2">{k}</th>)}<th className="text-right">Gesamt</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={String(r.period)}><td className="py-1.5">{periodLabel(String(r.period))}</td>{keys.map((k) => <td key={k} className="text-right px-2"><Money cents={Number(r[k] ?? 0)} colored={false} /></td>)}<td className="text-right font-medium"><Money cents={Number(r.total)} colored={false} /></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/* ---------- Kontoabgleich ---------- */

function Audit({ f }: { f: ReportFilter }) {
  const rows = useQuery((b) => accountAudit(b, f), [JSON.stringify(f)]);
  useExportTable({
    name: 'kontoabgleich', head: ['Konto', 'Person', 'Anfangsstand', 'Einnahmen', 'Ausgaben', 'Umbuchungen', 'Endstand', 'Nicht durch Buchungen erklärt'],
    rows: rows.map((r) => [r.name, r.owner ?? '', eur(r.start), eur(r.income), eur(r.expense), eur(r.transfers), eur(r.end), eur(r.gap)]),
  });
  return (
    <section className="card p-4 overflow-x-auto">
      <p className="text-sm text-text-muted mb-3">Je Konto: Stand vor dem Zeitraum, Bewegungen und Stand am Ende. Die letzte Spalte zeigt Veränderungen, die nur aus erfassten Kontoständen stammen. Bei Konten mit vollständig importierten Umsätzen sollte dort 0 € stehen.</p>
      <table className="w-full text-sm min-w-[760px]">
        <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Konto</th><th className="text-right">Anfang</th><th className="text-right">Einnahmen</th><th className="text-right">Ausgaben</th><th className="text-right">Umbuchungen</th><th className="text-right">Ende</th><th className="text-right">Nicht erklärt</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">{r.name}{r.owner && <span className="text-text-muted"> · {r.owner}</span>}</td>
              <td className="text-right"><Money cents={r.start} colored={false} /></td>
              <td className="text-right"><Money cents={r.income} /></td>
              <td className="text-right"><Money cents={-r.expense} /></td>
              <td className="text-right"><Money cents={r.transfers} colored={false} /></td>
              <td className="text-right font-medium"><Money cents={r.end} colored={false} /></td>
              <td className={`text-right ${r.gap ? 'text-warning font-medium' : 'text-text-muted'}`}>{formatCents(r.gap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

