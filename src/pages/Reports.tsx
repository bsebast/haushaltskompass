import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../state';
import { PageHeader, Money, Dot } from '../components/ui';
import { IncomeExpenseChart, BalanceChart, DonutChart } from '../components/charts';
import { monthlyTotals, categoryTotals, balanceTrend } from '../db/reports';
import { listCategories } from '../db/repo';
import { currentMonth, addMonths, monthLabel, monthRange } from '../lib/dates';

type Tab = 'month' | 'year' | 'compare' | 'longterm';
const TABS: [Tab, string][] = [['month', 'Monat'], ['year', 'Jahr'], ['compare', 'Monatsvergleich'], ['longterm', 'Langzeit']];

export default function Reports() {
  const [tab, setTab] = useState<Tab>('month');
  return (
    <>
      <PageHeader title="Auswertungen" />
      <div role="tablist" className="inline-flex rounded-md bg-surface-2 p-1 mb-4 flex-wrap">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3 h-8 rounded text-sm font-medium ${tab === k ? 'bg-surface shadow-card' : 'text-text-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'month' && <MonthView />}
      {tab === 'year' && <YearView />}
      {tab === 'compare' && <CompareView />}
      {tab === 'longterm' && <LongTermView />}
    </>
  );
}

function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return <input type="month" className="input w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" />;
}

function CategoryBreakdown({ from, to, kind }: { from: string; to: string; kind: 'expense' | 'income' }) {
  const [parent, setParent] = useState<string | null>(null);
  const rows = useQuery((b) => categoryTotals(b, from, to, kind, { parentId: parent }), [from, to, kind, parent]);
  const cats = useQuery(listCategories);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const hasChildren = (id: string | null) => !!id && cats.some((c) => c.parent_id === id);
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">{kind === 'expense' ? 'Ausgaben' : 'Einnahmen'} nach Kategorie {parent && <>› {cats.find((c) => c.id === parent)?.name}</>}</h2>
        {parent && <button className="text-xs text-accent hover:underline" onClick={() => setParent(null)}>Zurück</button>}
      </div>
      {rows.length === 0 ? <p className="text-sm text-text-muted">Keine Daten in diesem Zeitraum.</p> : (
        <div className="grid sm:grid-cols-[200px_1fr] gap-4 items-center">
          <DonutChart data={rows} height={200} />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.category_id ?? 'none'}>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <Dot color={r.color} />
                      {hasChildren(r.category_id) ? <button className="hover:underline text-left" onClick={() => setParent(r.category_id)}>{r.name} ›</button>
                        : <Link className="hover:underline" to={`/buchungen?${r.category_id ? `kategorie=${r.category_id}&` : ''}`}>{r.name}</Link>}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-text-muted text-xs w-14">{Math.round(r.share * 100)} %</td>
                  <td className="py-1.5 text-right w-28"><Money cents={r.amount} colored={false} /></td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-1.5">Summe</td><td /><td className="py-1.5 text-right"><Money cents={total} colored={false} /></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Kpis({ income, expense }: { income: number; expense: number }) {
  const rate = income > 0 ? (income - expense) / income : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {[
        ['Einnahmen', <Money key="i" cents={income} />],
        ['Ausgaben', <Money key="e" cents={-expense} />],
        ['Saldo', <Money key="s" cents={income - expense} />],
        ['Sparquote', <span key="q">{rate === null ? '–' : `${Math.round(rate * 100)} %`}</span>],
      ].map(([l, v], i) => (
        <div key={i} className="card p-4"><div className="text-xs text-text-muted">{l}</div><div className="text-xl font-semibold mt-1">{v}</div></div>
      ))}
    </div>
  );
}

function MonthView() {
  const [month, setMonth] = useState(currentMonth());
  const r = monthRange(month);
  const [t] = useQuery((b) => monthlyTotals(b, month, month), [month]);
  return (
    <>
      <div className="mb-4"><MonthPicker month={month} setMonth={setMonth} /></div>
      <Kpis income={t.income} expense={t.expense} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CategoryBreakdown from={r.from} to={r.to} kind="expense" />
        <CategoryBreakdown from={r.from} to={r.to} kind="income" />
      </div>
    </>
  );
}

function YearView() {
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const months = useQuery((b) => monthlyTotals(b, `${year}-01`, `${year}-12`), [year]);
  const income = months.reduce((a, m) => a + m.income, 0);
  const expense = months.reduce((a, m) => a + m.expense, 0);
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button className="btn-secondary" onClick={() => setYear(year - 1)}>‹</button>
        <span className="font-medium w-16 text-center">{year}</span>
        <button className="btn-secondary" onClick={() => setYear(year + 1)}>›</button>
      </div>
      <Kpis income={income} expense={expense} />
      <section className="card p-4 mb-4"><h2 className="text-sm font-semibold mb-3">Einnahmen und Ausgaben je Monat</h2><IncomeExpenseChart data={months} /></section>
      <section className="card p-4 mb-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Monat</th><th className="text-right">Einnahmen</th><th className="text-right">Ausgaben</th><th className="text-right">Saldo</th></tr></thead>
          <tbody className="divide-y divide-border">
            {months.map((m) => (
              <tr key={m.month}><td className="py-1.5">{monthLabel(m.month, true)}</td><td className="text-right"><Money cents={m.income} /></td><td className="text-right"><Money cents={-m.expense} /></td><td className="text-right font-medium"><Money cents={m.net} /></td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <CategoryBreakdown from={`${year}-01-01`} to={`${year}-12-31`} kind="expense" />
    </>
  );
}

function CompareView() {
  const [a, setA] = useState(addMonths(currentMonth(), -1));
  const [b, setB] = useState(currentMonth());
  const ra = monthRange(a);
  const rb = monthRange(b);
  const ca = useQuery((bk) => categoryTotals(bk, ra.from, ra.to, 'expense'), [a]);
  const cb = useQuery((bk) => categoryTotals(bk, rb.from, rb.to, 'expense'), [b]);
  const keys = [...new Set([...ca, ...cb].map((c) => c.category_id))];
  const rows = keys.map((k) => {
    const x = ca.find((c) => c.category_id === k);
    const y = cb.find((c) => c.category_id === k);
    return { k, name: (x ?? y)!.name, color: (x ?? y)!.color, a: x?.amount ?? 0, b: y?.amount ?? 0 };
  }).sort((p, q) => Math.abs(q.b - q.a) - Math.abs(p.b - p.a));
  const sa = rows.reduce((s, r) => s + r.a, 0);
  const sb = rows.reduce((s, r) => s + r.b, 0);
  return (
    <section className="card p-4 overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MonthPicker month={a} setMonth={setA} /><span className="text-text-muted">mit</span><MonthPicker month={b} setMonth={setB} />
      </div>
      <table className="w-full text-sm min-w-[560px]">
        <thead className="text-xs text-text-muted"><tr><th className="text-left py-1">Kategorie</th><th className="text-right">{monthLabel(a, true)}</th><th className="text-right">{monthLabel(b, true)}</th><th className="text-right">Differenz</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.k ?? 'none'}>
              <td className="py-1.5"><span className="inline-flex items-center gap-2"><Dot color={r.color} />{r.name}</span></td>
              <td className="text-right"><Money cents={r.a} colored={false} /></td>
              <td className="text-right"><Money cents={r.b} colored={false} /></td>
              <td className={`text-right font-medium ${r.b > r.a ? 'text-expense' : r.b < r.a ? 'text-income' : ''}`}>{r.b > r.a ? '+' : ''}<Money cents={r.b - r.a} colored={false} /></td>
            </tr>
          ))}
          <tr className="font-semibold"><td className="py-1.5">Summe Ausgaben</td><td className="text-right"><Money cents={sa} colored={false} /></td><td className="text-right"><Money cents={sb} colored={false} /></td><td className="text-right">{sb > sa ? '+' : ''}<Money cents={sb - sa} colored={false} /></td></tr>
        </tbody>
      </table>
    </section>
  );
}

function LongTermView() {
  const [months, setMonths] = useState(24);
  const end = currentMonth();
  const start = addMonths(end, -(months - 1));
  const totals = useQuery((b) => monthlyTotals(b, start, end), [start]);
  const trend = useQuery((b) => balanceTrend(b, start, end), [start]);
  const avgE = Math.round(totals.reduce((a, m) => a + m.expense, 0) / totals.length);
  const avgI = Math.round(totals.reduce((a, m) => a + m.income, 0) / totals.length);
  return (
    <>
      <div className="mb-4">
        <select className="input w-44" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Zeitraum">
          <option value={12}>12 Monate</option><option value={24}>24 Monate</option><option value={36}>3 Jahre</option><option value={60}>5 Jahre</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card p-4"><div className="text-xs text-text-muted">Ø Einnahmen pro Monat</div><div className="text-xl font-semibold mt-1"><Money cents={avgI} /></div></div>
        <div className="card p-4"><div className="text-xs text-text-muted">Ø Ausgaben pro Monat</div><div className="text-xl font-semibold mt-1"><Money cents={-avgE} /></div></div>
      </div>
      <section className="card p-4 mb-4"><h2 className="text-sm font-semibold mb-3">Vermögensverlauf (alle Konten)</h2><BalanceChart data={trend} height={260} /></section>
      <section className="card p-4"><h2 className="text-sm font-semibold mb-3">Einnahmen und Ausgaben</h2><IncomeExpenseChart data={totals} /></section>
    </>
  );
}
