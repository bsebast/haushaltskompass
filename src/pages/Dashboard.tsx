import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../state';
import { Money, Bar, Dot, Empty } from '../components/ui';
import { BalanceChart, DonutChart, IncomeExpenseChart } from '../components/charts';
import type { CategoryTotal } from '../db/reports';
import type { Book } from '../db/core';
import { listAccounts, listTransactions, listCategories } from '../db/repo';
import { monthLeft, balanceTrend, budgetStatus, categoryTotals, monthlyTotals, savingHints } from '../db/reports';
import { currentMonth, addMonths, monthRange, monthLabel, formatDate } from '../lib/dates';
import { ACCOUNT_TYPES } from '../db/types';
import { useTxDialog } from '../components/Layout';
import { DrillCell, useDrill, partsFromLines, partsFromTx } from '../components/DrillDown';
import { reportLines } from '../db/analytics';
import { listContracts, perMonth, upcoming } from '../db/contracts';

function Card({ title, link, children, className = '' }: { title: string; link?: [string, string]; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {link && <Link to={link[0]} className="text-xs text-accent hover:underline">{link[1]}</Link>}
      </div>
      {children}
    </section>
  );
}

type Span = 'month' | 'year';

/** Sammelposten für Gutschriften auf Ausgabe-Kategorien (Rückzahlungen, Gutschriften vom Händler usw.). */
const REFUNDS = '__rueckfluesse';

function expenseRootIds(b: Book): Set<string> {
  return new Set(listCategories(b).filter((c) => !c.parent_id && c.kind === 'expense').map((c) => c.id));
}

/**
 * Einnahmen nach Hauptkategorie. Umbuchungen und neutrale externe Konten zählen nicht.
 * Gutschriften auf Ausgabe-Kategorien werden zu einem Posten „Rückflüsse aus Ausgaben“ zusammengefasst.
 */
function incomeComposition(b: Book, from: string, to: string): CategoryTotal[] {
  const rows = categoryTotals(b, from, to, 'income', { excludeExternal: true });
  const exp = expenseRootIds(b);
  const out = rows.filter((r) => !r.category_id || !exp.has(r.category_id));
  const refunds = rows.filter((r) => r.category_id && exp.has(r.category_id)).reduce((a, r) => a + r.amount, 0);
  if (refunds) out.push({ category_id: REFUNDS, name: 'Rückflüsse aus Ausgaben', color: '#b9a27a', amount: refunds, share: 0 });
  const total = out.reduce((a, r) => a + r.amount, 0) || 1;
  return out.map((r) => ({ ...r, share: r.amount / total })).sort((a, b) => b.amount - a.amount);
}

/** Zeitraum der Kategorie-Karten: laufender Monat oder Jahr bis heute. */
function spanRange(span: Span, month: string): { from: string; to: string; label: string } {
  if (span === 'month') return { ...monthRange(month), label: monthLabel(month, true) };
  const y = month.slice(0, 4);
  return { from: `${y}-01-01`, to: monthRange(month).to, label: `Jahr ${y}` };
}

function SpanToggle({ value, onChange }: { value: Span; onChange: (s: Span) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border text-xs overflow-hidden" role="group" aria-label="Zeitraum">
      {(['month', 'year'] as const).map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} aria-pressed={value === s}
          className={`px-2 py-0.5 ${value === s ? 'bg-accent text-white' : 'text-text-muted hover:text-text'}`}>
          {s === 'month' ? 'Monat' : 'Jahr'}
        </button>
      ))}
    </div>
  );
}

/** Kreisdiagramm mit Top-Liste für Ausgaben oder Einnahmen nach (Haupt-)Kategorie; Klick öffnet die Buchungen. */
function CategoryCard({ kind, data, span, onSpan, onPick }: {
  kind: 'income' | 'expense'; data: CategoryTotal[]; span: Span; onSpan: (s: Span) => void; onPick: (c: CategoryTotal) => void;
}) {
  const none = kind === 'income' ? 'Einnahmen' : 'Ausgaben';
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">{none} nach Kategorie</h2>
        <div className="flex items-center gap-2">
          <SpanToggle value={span} onChange={onSpan} />
          <Link to="/auswertungen" className="text-xs text-accent hover:underline">Details</Link>
        </div>
      </div>
      {data.length === 0 ? <p className="text-sm text-text-muted">{span === 'month' ? 'Diesen Monat' : 'Dieses Jahr'} noch keine {none}.</p> : (
        <>
          <DonutChart data={data.slice(0, 8)} height={160} onPick={onPick} />
          <ul className="mt-2 space-y-1 text-sm">
            {data.slice(0, 5).map((c) => (
              <li key={c.category_id ?? 'none'} className="flex items-center gap-2">
                <Dot color={c.color} /><span className="flex-1 truncate"><DrillCell onClick={() => onPick(c)}>{c.name}</DrillCell></span>
                <span className="text-text-muted text-xs">{Math.round(c.share * 100)} %</span>
                <Money cents={c.amount} colored={false} />
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-border mt-2 pt-1.5 text-sm font-semibold">
            <span>Summe</span><Money cents={data.reduce((a, c) => a + c.amount, 0)} colored={false} />
          </div>
        </>
      )}
    </section>
  );
}

export default function Dashboard() {
  const m = currentMonth();
  const left = useQuery((b) => monthLeft(b, m), [m]);
  const accounts = useQuery((b) => listAccounts(b));
  const trend = useQuery((b) => balanceTrend(b, addMonths(m, -11), m), [m]);
  const totals = useQuery((b) => monthlyTotals(b, addMonths(m, -5), m), [m]);
  const budgets = useQuery((b) => budgetStatus(b, m), [m]);
  const [expSpan, setExpSpan] = useState<Span>('month');
  const [incSpan, setIncSpan] = useState<Span>('month');
  const expR = spanRange(expSpan, m);
  const incR = spanRange(incSpan, m);
  const topCats = useQuery((b) => categoryTotals(b, expR.from, expR.to, 'expense', { excludeExternal: true }), [expR.from, expR.to]);
  const incomeCats = useQuery((b) => incomeComposition(b, incR.from, incR.to), [incR.from, incR.to]);
  const recent = useQuery((b) => listTransactions(b, { limit: 8 }));
  const hints = useQuery((b) => savingHints(b, m), [m]);
  const open = useQuery((b) => listTransactions(b, { uncategorized: true }).length);
  const contracts = useQuery((b) => listContracts(b));
  const { openNew } = useTxDialog();
  const total = accounts.filter((a) => !a.external).reduce((s, a) => s + a.balance, 0);
  const drill = useDrill();
  const showMonth = (month: string, kind: 'income' | 'expense', root?: { id: string | null; name: string }) => {
    const mr = monthRange(month);
    drill({
      title: `${kind === 'income' ? 'Einnahmen' : 'Ausgaben'}${root ? ` · ${root.name}` : ''} · ${monthLabel(month, true)}`,
      load: (b) => partsFromLines(reportLines(b, mr).filter((l) => (kind === 'income') === (l.amount > 0) && (!root || l.root_id === root.id))),
    });
  };
  /** Buchungen einer Kategorie im Zeitraum der Karte (ohne Umbuchungen und ohne neutrale externe Konten). */
  const showCategory = (span: { from: string; to: string; label: string }, kind: 'income' | 'expense', c: CategoryTotal) => {
    drill({
      title: `${kind === 'income' ? 'Einnahmen' : 'Ausgaben'} · ${c.name} · ${span.label}`,
      load: (b) => {
        const ext = new Set(listAccounts(b, true).filter((a) => a.external).map((a) => a.id));
        const refundRoots = c.category_id === REFUNDS ? expenseRootIds(b) : null;
        const inRoot = (root: string | null) => (refundRoots ? !!root && refundRoots.has(root) : root === c.category_id);
        return partsFromLines(reportLines(b, span).filter((l) => (kind === 'income') === (l.amount > 0) && inRoot(l.root_id) && !ext.has(l.account_id)));
      },
    });
  };
  const showMoves = (month: string) => {
    const mr = monthRange(month);
    drill({ title: `Kontobewegungen · ${monthLabel(month, true)}`, load: (b) => partsFromTx(b, { ...mr, accountIds: listAccounts(b, true).filter((a) => !a.external).map((a) => a.id) }) });
  };

  if (!recent.length && !contracts.length) {
    return (
      <div className="card">
        <Empty title="Willkommen in deinem Haushaltsbuch" text="Erfasse deine erste Ausgabe oder Einnahme. Danach füllt sich diese Übersicht von selbst."
          action={<button className="btn-primary" onClick={() => openNew()}>Erste Buchung erfassen</button>} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card title={`Was bleibt im ${monthLabel(m, true)}`} link={['/auswertungen', 'Auswertungen']}>
        <div className="text-3xl font-semibold"><Money cents={left.left} /></div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-text-muted text-xs">Einnahmen</dt><dd><DrillCell onClick={() => showMonth(m, 'income')}><Money cents={left.income} /></DrillCell></dd></div>
          <div><dt className="text-text-muted text-xs">Ausgaben</dt><dd><DrillCell onClick={() => showMonth(m, 'expense')}><Money cents={-left.expense} /></DrillCell></dd></div>
        </dl>
        {left.projectedLeft !== null && (
          <p className="text-xs text-text-muted mt-3">Hochrechnung bis Monatsende: <Money cents={left.projectedLeft} colored={false} className="font-medium text-text" /></p>
        )}
        {open > 0 && <p className="text-xs mt-2"><Link to="/buchungen" className="text-warning hover:underline">{open} Buchungen ohne Kategorie</Link></p>}
      </Card>

      <Card title="Konten" link={['/konten', 'Alle Konten']}>
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 text-sm">
              <Link to={`/buchungen?konto=${a.id}`} className="truncate hover:underline">{a.name} <span className="text-text-muted text-xs">{ACCOUNT_TYPES[a.type]}</span></Link>
              <Money cents={a.balance} />
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-border mt-3 pt-2 text-sm font-semibold"><span>Gesamt</span><Money cents={total} /></div>
      </Card>

      <Card title="Budgets diesen Monat" link={['/budgets', 'Verwalten']}>
        {budgets.length === 0 ? <p className="text-sm text-text-muted">Noch keine Budgets. <Link to="/budgets" className="text-accent hover:underline">Jetzt anlegen</Link></p> : (
          <ul className="space-y-3">
            {budgets.slice(0, 5).map((s) => (
              <li key={s.budget.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="truncate">{s.category.name}</span>
                  <span className="tabular-nums text-text-muted"><Money cents={s.spent} colored={false} /> / <Money cents={s.limit} colored={false} /></span>
                </div>
                <Bar ratio={s.ratio} state={s.state} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Kontostand der letzten 12 Monate" className="md:col-span-2">
        <BalanceChart data={trend} onPick={showMoves} />
      </Card>

      <CategoryCard kind="expense" data={topCats} span={expSpan} onSpan={setExpSpan} onPick={(c) => showCategory(expR, 'expense', c)} />

      <CategoryCard kind="income" data={incomeCats} span={incSpan} onSpan={setIncSpan} onPick={(c) => showCategory(incR, 'income', c)} />

      <Card title="Einnahmen und Ausgaben" className="md:col-span-2">
        <IncomeExpenseChart data={totals} height={220} onPick={(month, k) => showMonth(month, k)} />
      </Card>

      <Card title="Sparpotenzial">
        {hints.length === 0 ? <p className="text-sm text-text-muted">Für Hinweise braucht es etwas mehr Buchungen.</p> : (
          <ul className="space-y-3 text-sm">
            {hints.slice(0, 4).map((h, i) => (
              <li key={i}>
                <Link to={h.category_id ? `/buchungen?kategorie=${h.category_id}&zeitraum=month` : '/buchungen'} className="font-medium hover:underline">{h.title}</Link>
                <p className="text-xs text-text-muted">{h.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>


      {contracts.length > 0 && (
        <Card title="Fixkosten" link={['/vertraege', 'Alle Verträge']}>
          <div className="text-2xl font-semibold"><Money cents={contracts.reduce((a, c) => a + perMonth(c), 0)} /> <span className="text-sm font-normal text-text-muted">Ø pro Monat</span></div>
          <h3 className="text-xs text-text-muted mt-3 mb-1">Als Nächstes fällig</h3>
          <ul className="space-y-1.5 text-sm">
            {upcoming(contracts, 45).slice(0, 5).map(({ contract: c, date }) => (
              <li key={c.id} className="flex gap-2"><span className="tabular-nums text-text-muted w-20">{formatDate(date)}</span><span className="flex-1 truncate">{c.name}</span><Money cents={c.amount} /></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Letzte Buchungen" link={['/buchungen', 'Alle Buchungen']} className="md:col-span-2 xl:col-span-3">
        <ul className="divide-y divide-border">
          {recent.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-text-muted tabular-nums w-20">{formatDate(t.date)}</span>
              <span className="flex-1 truncate">{t.payee ?? '–'}</span>
              <span className="hidden sm:flex items-center gap-1.5 text-text-muted w-40 truncate">{t.category_name && <Dot color={t.category_color} />}{t.transfer_id ? 'Umbuchung' : t.category_name ?? (t.split_count ? 'Aufgeteilt' : '')}</span>
              <Money cents={t.amount} colored={!t.transfer_id} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
