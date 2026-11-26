import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '../state';
import { Money, Bar, Dot, Empty, PageHeader } from '../components/ui';
import { BalanceChart, DonutChart, IncomeExpenseChart } from '../components/charts';
import type { CategoryTotal } from '../db/reports';
import type { Book } from '../db/core';
import { listAccounts, listTransactions, listCategories } from '../db/repo';
import { balanceTrend, balancesAt, budgetStatus, budgetStatusRange, categoryTotals, monthLeft, monthlyTotals, rangeTotals, savingHints } from '../db/reports';
import { addMonths, monthRange, monthLabel, formatDate, today } from '../lib/dates';
import { formatPeriod, parsePeriod, periodRange, previousRange, shiftPeriod, switchKind, type Period, type PeriodRange } from '../lib/period';
import { ACCOUNT_TYPES } from '../db/types';
import { useTxDialog } from '../components/Layout';
import { DrillCell, useDrill, partsFromLines, partsFromTx } from '../components/DrillDown';
import { monthBalance, monthBalanceLines, periodCashflow, reportLines, type MonthBalance } from '../db/analytics';
import { listContracts, perMonth, upcoming } from '../db/contracts';
import { dueIn } from '../db/forecast';
import { goalColor, goalProgress, listGoals } from '../db/goals';
import { listAlerts } from '../db/alerts';
import { listInventory, warrantyEndingSoon } from '../db/inventory';
import { formatCents } from '../lib/money';

function Card({ title, link, children, className = '' }: { title: string; link?: [string, string]; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {link && <Link to={link[0]} className="text-xs text-accent hover:underline">{link[1]}</Link>}
      </div>
      {children}
    </section>
  );
}

/** Veränderung zum Vergleichszeitraum; good = Richtung, die gut ist (mehr Einnahmen, weniger Ausgaben). */
function Delta({ value, good, label, unit = 'eur', short }: { value: number | null; good: 'up' | 'down'; label: string; unit?: 'eur' | 'pp'; short?: boolean }) {
  if (value === null) return null;
  const zero = unit === 'eur' ? value === 0 : Math.round(value * 100) === 0;
  const better = good === 'up' ? value > 0 : value < 0;
  const cls = zero ? 'text-text-muted' : better ? 'text-success' : 'text-danger';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const text = unit === 'eur' ? formatCents(Math.abs(value)) : `${Math.abs(Math.round(value * 100))} Pp.`;
  return <div className={`text-xs ${cls}`} title={`Veränderung ggü. ${label}`}>{zero ? 'gleich' : `${sign}${text}`}{!short && <span className="text-text-muted"> ggü. {label}</span>}</div>;
}

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);

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

/** Umschalter oben auf der Übersicht: beliebiger Monat oder Jahr bis heute (YTD), mit Vor/Zurück. */
function PeriodPicker({ period, range, firstMonth, onChange }: { period: Period; range: PeriodRange; firstMonth: string; onChange: (p: Period) => void }) {
  const now = today();
  const isMonth = period.kind === 'month';
  const step = isMonth ? 'Monat' : 'Jahr';
  const lastMonth = now.slice(0, 7);
  const months: string[] = [];
  for (let m = lastMonth; m >= firstMonth && months.length < 240; m = addMonths(m, -1)) months.push(m);
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
  const value = isMonth ? period.month : String(period.year);
  // ein Zeitraum außerhalb der Liste (z. B. per Link) bleibt wählbar
  if (isMonth && !months.includes(period.month)) months.push(period.month);
  if (!isMonth && !years.includes(period.year)) years.push(period.year);
  const options = isMonth
    ? [...months].sort().reverse().map((m) => [m, monthLabel(m, true)])
    : [...years].sort((a, b) => b - a).map((y) => [String(y), String(y) === now.slice(0, 4) ? `${y} bis heute` : `Jahr ${y}`]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-full bg-surface-2 p-0.5 text-sm" role="group" aria-label="Zeitraum">
        {(['month', 'ytd'] as const).map((k) => (
          <button key={k} type="button" onClick={() => onChange(switchKind(period, k))} aria-pressed={period.kind === k}
            className={`px-3 py-1 rounded-full ${period.kind === k ? 'bg-surface text-text font-medium shadow-card' : 'text-text-muted hover:text-text'}`}>
            {k === 'month' ? 'Monat' : 'YTD'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button className="btn-secondary w-9 px-0" aria-label={`Vorheriger ${step}`} onClick={() => onChange(shiftPeriod(period, -1))}><ChevronLeft size={16} /></button>
        <select className="input w-44" aria-label={isMonth ? 'Monat wählen' : 'Jahr wählen'} value={value}
          onChange={(e) => onChange(isMonth ? { kind: 'month', month: e.target.value } : { kind: 'ytd', year: Number(e.target.value) })}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-secondary w-9 px-0 disabled:opacity-40" aria-label={`Nächster ${step}`} disabled={range.current}
          onClick={() => onChange(shiftPeriod(period, 1))}><ChevronRight size={16} /></button>
      </div>
      {!range.current && (
        <button className="btn-ghost" onClick={() => onChange(isMonth ? { kind: 'month', month: lastMonth } : { kind: 'ytd', year: Number(now.slice(0, 4)) })}>Heute</button>
      )}
    </div>
  );
}

/** Kreisdiagramm mit Top-Liste für Ausgaben oder Einnahmen nach (Haupt-)Kategorie; Klick öffnet die Buchungen. */
function CategoryCard({ kind, data, label, onPick }: {
  kind: 'income' | 'expense'; data: CategoryTotal[]; label: string; onPick: (c: CategoryTotal) => void;
}) {
  const none = kind === 'income' ? 'Einnahmen' : 'Ausgaben';
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold tracking-tight">{none} nach Kategorie <span className="font-normal text-text-muted">· {label}</span></h2>
        <Link to="/auswertungen" className="text-xs text-accent hover:underline">Details</Link>
      </div>
      {data.length === 0 ? <p className="text-sm text-text-muted">Im Zeitraum {label} keine {none}.</p> : (
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
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params.get('zeitraum'));
  const range = periodRange(period);
  const setPeriod = (p: Period) => {
    const next = new URLSearchParams(params);
    const v = formatPeriod(p);
    if (v) next.set('zeitraum', v); else next.delete('zeitraum');
    setParams(next, { replace: true });
  };
  const isMonth = period.kind === 'month';
  /** Monat, auf den sich monatsbezogene Karten (Budgets im Monatsmodus, Sparpotenzial) beziehen */
  const m = range.toMonth;
  const { from, to, fromMonth, toMonth } = range;
  const firstMonth = useQuery((b) => (b.value<string>('select min(date) from transactions') ?? today()).slice(0, 7));
  const leftMonth = useQuery((b) => monthLeft(b, m), [m]);
  const balance = useQuery((b) => (isMonth ? monthBalance(b, m) : null), [isMonth, m]);
  // YTD zählt nur Buchungen bis heute (bzw. Jahresende), der Monatsmodus wie bisher den ganzen Monat
  const ytdTotals = useQuery((b) => {
    if (isMonth) return null;
    const r = b.get<{ income: number; expense: number }>(
      `select coalesce(sum(case when a > 0 then a else 0 end), 0) as income, coalesce(-sum(case when a < 0 then a else 0 end), 0) as expense
       from (select coalesce(s.amount, t.amount) as a from transactions t left join splits s on s.transaction_id = t.id
             where t.transfer_id is null and t.date between ? and ?)`, [from, to]);
    return r ?? { income: 0, expense: 0 };
  }, [isMonth, from, to]);
  const income = ytdTotals?.income ?? leftMonth.income;
  const expense = ytdTotals?.expense ?? leftMonth.expense;
  /** Vergleich: Vormonat (laufend: bis zum gleichen Tag) bzw. gleicher Zeitraum im Vorjahr */
  const prev = previousRange(period);
  const prevTotals = useQuery((b) => rangeTotals(b, prev.from, prev.to), [prev.from, prev.to]);
  const hasPrev = useQuery((b) => (b.value<number>('select count(*) from transactions where date between ? and ?', [prev.from, prev.to]) ?? 0) > 0, [prev.from, prev.to]);
  const flow = useQuery((b) => periodCashflow(b, from, to), [from, to]);
  const prevFlow = useQuery((b) => periodCashflow(b, prev.from, prev.to), [prev.from, prev.to]);
  const goals = useQuery((b) => goalProgress(b, listGoals(b).filter((g) => !g.done)));
  const monthCount = (Number(toMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12 + Number(toMonth.slice(5)) - Number(fromMonth.slice(5)) + 1;
  const accounts = useQuery((b) => listAccounts(b));
  /** Kontostände zum Periodenende; im laufenden Zeitraum der aktuelle Stand */
  const balances = useQuery((b) => {
    const list = listAccounts(b);
    if (range.current) return new Map(list.map((a) => [a.id, a.balance]));
    const per = balancesAt(b, [to], list.map((a) => a.id));
    return new Map(list.map((a) => [a.id, per.get(a.id)?.[0] ?? 0]));
  }, [range.current, to]);
  const balanceOf = (id: string) => balances.get(id) ?? 0;
  const trend = useQuery((b) => balanceTrend(b, addMonths(toMonth, -11), toMonth), [toMonth]);
  const chartFrom = isMonth ? addMonths(m, -5) : fromMonth;
  const totals = useQuery((b) => monthlyTotals(b, chartFrom, toMonth), [chartFrom, toMonth]);
  const budgets = useQuery((b) => (isMonth ? budgetStatus(b, m) : budgetStatusRange(b, from, to)), [isMonth, m, from, to]);
  const catRange = { from, to, label: range.label };
  const topCats = useQuery((b) => categoryTotals(b, from, to, 'expense', { excludeExternal: true }), [from, to]);
  const incomeCats = useQuery((b) => incomeComposition(b, from, to), [from, to]);
  const recent = useQuery((b) => listTransactions(b, { to, limit: 8 }), [to]);
  const anyTx = useQuery((b) => listTransactions(b, { limit: 1 }).length > 0);
  const hints = useQuery((b) => savingHints(b, m), [m]);
  const open = useQuery((b) => listTransactions(b, { uncategorized: true }).length);
  const contracts = useQuery((b) => listContracts(b));
  const budgetReserve = budgets.reduce((a, s) => a + Math.max(0, s.limit - s.spent), 0);
  const fixedThisMonth = -contracts.filter((c) => c.amount < 0 && dueIn(c, m)).reduce((a, c) => a + c.amount, 0);
  const alerts = useQuery(listAlerts);
  const warranties = useQuery((b) => listInventory(b).filter((x) => warrantyEndingSoon(x, 30)));
  const { openNew } = useTxDialog();
  const total = accounts.filter((a) => !a.external).reduce((s, a) => s + balanceOf(a.id), 0);
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
  /** Einnahmen oder Ausgaben des ganzen gewählten Zeitraums */
  const showPeriod = (kind: 'income' | 'expense') => {
    if (isMonth) return showMonth(m, kind);
    drill({
      title: `${kind === 'income' ? 'Einnahmen' : 'Ausgaben'} · ${range.label}`,
      load: (b) => partsFromLines(reportLines(b, { from, to }).filter((l) => (kind === 'income') === (l.amount > 0))),
    });
  };
  const showMoves = (month: string) => {
    const mr = monthRange(month);
    drill({ title: `Kontobewegungen · ${monthLabel(month, true)}`, load: (b) => partsFromTx(b, { ...mr, accountIds: listAccounts(b, true).filter((a) => !a.external).map((a) => a.id) }) });
  };

  if (!anyTx && !contracts.length) {
    return (
      <div className="card">
        <Empty title="Willkommen in deinem Haushaltsbuch" text="Erfasse deine erste Ausgabe oder Einnahme. Danach füllt sich diese Übersicht von selbst."
          action={<button className="btn-primary" onClick={() => openNew()}>Erste Buchung erfassen</button>} />
      </div>
    );
  }

  return (
    <>
    <PageHeader title="Übersicht"
      subtitle={range.current
        ? `${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Gesamtvermögen ${formatCents(total)}`
        : `${range.label} · Gesamtvermögen am ${formatDate(to)}: ${formatCents(total)}`}
      actions={<PeriodPicker period={period} range={range} firstMonth={firstMonth} onChange={setPeriod} />} />
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
      {(alerts.length > 0 || warranties.length > 0) && (
        <section role="status" className="card p-5 md:col-span-2 xl:col-span-3 border-warning/50 bg-warning/5">
          <h2 className="text-sm font-semibold mb-2">Hinweise</h2>
          <ul className="space-y-1 text-sm">
            {alerts.map((x) => (
              <li key={`${x.kind}-${x.id}-${x.dir}`}>
                <Link to={x.kind === 'account' ? `/buchungen?konto=${x.id}` : '/vermoegen'} className="font-medium hover:underline">{x.name}</Link>
                {x.kind === 'account' ? ': Kontostand ' : ': Kurs '}<Money cents={x.value} colored={false} className="font-medium" />
                {x.dir === 'below' ? ' liegt unter ' : ' liegt über '}der Grenze von {formatCents(x.limit)}{x.as_of ? <span className="text-text-muted text-xs"> (Stand {formatDate(x.as_of)})</span> : null}
              </li>
            ))}
            {warranties.map((x) => (
              <li key={x.id}><Link to="/inventar" className="font-medium hover:underline">{x.name}</Link>: Garantie endet am {formatDate(x.warranty_until!)}</li>
            ))}
          </ul>
        </section>
      )}
      <Card title={isMonth ? `Was bleibt im ${range.label}` : `Was bleibt · ${range.label}`} link={['/auswertungen', 'Auswertungen']}>
        <div className="text-4xl font-semibold mt-1"><Money cents={income - expense} /></div>
        {hasPrev && <Delta value={(income - expense) - (prevTotals.income - prevTotals.expense)} good="up" label={prev.label} />}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-text-muted text-xs">Einnahmen</dt><dd><DrillCell onClick={() => showPeriod('income')}><Money cents={income} /></DrillCell></dd>
            {hasPrev && <dd><Delta value={income - prevTotals.income} good="up" label={prev.label} short /></dd>}</div>
          <div><dt className="text-text-muted text-xs">Ausgaben</dt><dd><DrillCell onClick={() => showPeriod('expense')}><Money cents={-expense} /></DrillCell></dd>
            {hasPrev && <dd><Delta value={expense - prevTotals.expense} good="down" label={prev.label} short /></dd>}</div>
          <div><dt className="text-text-muted text-xs" title="(Einnahmen − Ausgaben) ÷ Einnahmen; Sparen & Anlegen zählt als gespart, wie in den Auswertungen">Sparquote</dt>
            <dd className="font-medium tabular-nums">{pct(flow.rate)}</dd>
            {hasPrev && flow.rate !== null && prevFlow.rate !== null && <dd><Delta value={flow.rate - prevFlow.rate} good="up" unit="pp" label={prev.label} short /></dd>}</div>
        </dl>
        {isMonth && leftMonth.projectedLeft !== null && (
          <p className="text-xs text-text-muted mt-3">Hochrechnung bis Monatsende: <Money cents={leftMonth.projectedLeft} colored={false} className="font-medium text-text" /></p>
        )}
        {!isMonth && monthCount > 1 && (
          <p className="text-xs text-text-muted mt-3">Ø je Monat: <Money cents={Math.round((income - expense) / monthCount)} colored={false} className="font-medium text-text" /></p>
        )}
        {open > 0 && <p className="text-xs mt-2"><Link to="/buchungen" className="text-warning hover:underline">{open} Buchungen ohne Kategorie</Link></p>}
      </Card>
      {balance && (balance.fixed > 0 || balance.flex > 0) && <MonthBalanceCard v={balance} label={range.label}
        onFlex={() => drill({ title: `Flexkosten · ${range.label}`, load: (b) => partsFromLines(monthBalanceLines(b, m, 'flex')) })}
        onFixed={() => drill({ title: `Gebuchte Fixkosten · ${range.label}`, load: (b) => partsFromLines(monthBalanceLines(b, m, 'fixed')) })} />}

      <Card title={range.current ? 'Konten' : `Konten am ${formatDate(to)}`} link={['/konten', 'Alle Konten']}>
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 text-sm">
              <Link to={`/buchungen?konto=${a.id}`} className="truncate hover:underline">{a.name} <span className="text-text-muted text-xs">{ACCOUNT_TYPES[a.type]}</span></Link>
              <Money cents={balanceOf(a.id)} />
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-border mt-3 pt-2 text-sm font-semibold"><span>Gesamt</span><Money cents={total} /></div>
      </Card>

      <Card title={isMonth ? `Budgets im ${range.label}` : `Budgets · ${range.label}`} link={['/budgets', 'Verwalten']}>
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
        {(budgets.length > 0 || (isMonth && fixedThisMonth > 0)) && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border mt-3 pt-2 text-xs text-text-muted">
            {budgets.length > 0 && <span title="Summe dessen, was in den Budgets noch nicht verbraucht ist">Budgetreserve <Money cents={budgetReserve} colored={false} className="font-medium text-text" /></span>}
            {isMonth && fixedThisMonth > 0 && <span title="Ausgaben aus Verträgen, die in diesem Monat fällig sind">Fixkosten im {monthLabel(m, true).split(' ')[0]} <Money cents={fixedThisMonth} colored={false} className="font-medium text-text" /></span>}
          </p>
        )}
      </Card>

      <Card title="Sparziele" link={['/sparziele', goals.length ? 'Alle Ziele' : 'Anlegen']}>
        {goals.length === 0 ? <p className="text-sm text-text-muted">Noch keine Sparziele. Lege z. B. einen Notgroschen oder den nächsten Urlaub an und verfolge, wie weit du bist. <Link to="/sparziele" className="text-accent hover:underline">Ziel anlegen</Link></p> : (
          <ul className="space-y-3">
            {goals.slice(0, 4).map((p, i) => (
              <li key={p.goal.id}>
                <div className="flex justify-between gap-2 text-sm mb-1">
                  <span className="truncate font-medium">{p.goal.name}</span>
                  <span className="tabular-nums text-text-muted whitespace-nowrap"><Money cents={p.current} colored={false} /> / <Money cents={p.goal.target} colored={false} /></span>
                </div>
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-label={p.goal.name} aria-valuenow={Math.round(p.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full" style={{ width: `${p.ratio * 100}%`, background: goalColor(p.goal, i) }} />
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {Math.round(p.ratio * 100)} %{p.goal.target_date && ` · bis ${formatDate(p.goal.target_date)}`}
                  {p.reached ? ' · erreicht' : p.overdue ? <span className="text-warning"> · Datum überschritten</span> : p.perMonth ? ` · ${formatCents(p.perMonth)} im Monat nötig` : p.eta ? ` · erreicht etwa ${monthLabel(p.eta, true)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={range.current ? 'Kontostand der letzten 12 Monate' : `Kontostand der 12 Monate bis ${monthLabel(toMonth, true)}`} className="md:col-span-2">
        <BalanceChart data={trend} height={300} onPick={showMoves} />
      </Card>

      <CategoryCard kind="expense" data={topCats} label={range.label} onPick={(c) => showCategory(catRange, 'expense', c)} />

      <CategoryCard kind="income" data={incomeCats} label={range.label} onPick={(c) => showCategory(catRange, 'income', c)} />

      <Card title={isMonth ? `Einnahmen und Ausgaben, 6 Monate bis ${range.label}` : `Einnahmen und Ausgaben · ${range.label}`} className="md:col-span-2">
        <IncomeExpenseChart data={totals} height={220} onPick={(month, k) => showMonth(month, k)} />
      </Card>

      <Card title={`Sparpotenzial im ${monthLabel(m, true)}`}>
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

      <Card title={range.current ? 'Letzte Buchungen' : `Letzte Buchungen bis ${formatDate(to)}`} link={['/buchungen', 'Alle Buchungen']} className="md:col-span-2 xl:col-span-3">
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
    </>
  );
}

/**
 * Echte Monatsbilanz: Verträge zählen jeden Monat mit ihrem Monatsanteil (Jahresbeiträge also mit 1/12),
 * alles andere sind Flexkosten. Was übrig bleibt, wird im laufenden Monat auf die restlichen Tage verteilt.
 */
function MonthBalanceCard({ v, label, onFlex, onFixed }: { v: MonthBalance; label: string; onFlex: () => void; onFixed: () => void }) {
  const reserve = v.fixed - v.fixedBooked;
  const flexShare = v.flexAvg > 0 ? v.flex / v.flexAvg : null;
  return (
    <Card title={`Echte Monatsbilanz · ${label}`} link={['/vertraege', 'Verträge']}>
      <div className="text-text-muted text-xs">{v.daysLeft !== null ? 'Noch frei verfügbar' : 'Frei geblieben'}</div>
      <div className="text-4xl font-semibold mt-1"><Money cents={v.free} /></div>
      {v.perDay !== null && v.daysLeft !== null && (
        <p className="text-sm mt-1">
          {v.free > 0 ? <>Das sind <Money cents={v.perDay} colored={false} className="font-semibold" /> pro Tag für die restlichen {v.daysLeft} {v.daysLeft === 1 ? 'Tag' : 'Tage'}.</>
            : <span className="text-danger">Die Flexkosten liegen schon über dem, was nach den Fixkosten übrig war.</span>}
        </p>
      )}
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-text-muted">Einnahmen</dt><dd><Money cents={v.income} colored={false} /></dd></div>
        {v.incomeExpected > 0 && (
          <div className="flex justify-between"><dt className="text-text-muted" title="Noch nicht gebucht: Durchschnitt der Einnahmen der letzten 3 Monate abzüglich der schon gebuchten">+ noch erwartet</dt>
            <dd><Money cents={v.incomeExpected} colored={false} /></dd></div>
        )}
        <div className="flex justify-between"><dt className="text-text-muted" title="Alle laufenden Verträge auf den Monat umgerechnet, jährliche und vierteljährliche anteilig">− Fixkosten (umgelegt)</dt>
          <dd><Money cents={-v.fixed} colored={false} /></dd></div>
        {v.savingPlans > 0 && (
          <div className="flex justify-between"><dt className="text-text-muted" title="Verträge unter Sparen & Anlegen, z. B. Sparpläne und Rücklagen. Wer sich zuerst selbst bezahlt, plant sie wie Fixkosten ein.">− feste Sparraten</dt>
            <dd><Money cents={-v.savingPlans} colored={false} /></dd></div>
        )}
        <div className="flex justify-between"><dt className="text-text-muted" title="Alle Ausgaben, die zu keinem Vertrag gehören (ohne Sparen & Anlegen und ohne Umbuchungen)">− Flexkosten</dt>
          <dd><DrillCell onClick={onFlex}><Money cents={-v.flex} colored={false} /></DrillCell></dd></div>
      </dl>
      {flexShare !== null && (
        <div className="mt-3">
          <Bar ratio={Math.min(1, flexShare)} state={flexShare > 1 ? 'over' : flexShare > 0.9 ? 'warn' : 'ok'} />
          <p className="text-xs text-text-muted mt-1">Flexkosten: {Math.round(flexShare * 100)} % vom Schnitt der letzten 3 Monate (<Money cents={v.flexAvg} colored={false} />)</p>
        </div>
      )}
      <p className="text-xs text-text-muted mt-2">
        Gebucht wurden <DrillCell onClick={onFixed}><Money cents={v.fixedBooked} colored={false} /></DrillCell> Fixkosten.{' '}
        {reserve > 0 ? <>Die übrigen <Money cents={reserve} colored={false} /> gehören in die Rücklage für spätere Abbuchungen.</>
          : reserve < 0 ? <><Money cents={-reserve} colored={false} /> mehr als der Monatsanteil, das kommt aus der Rücklage.</> : null}
      </p>
    </Card>
  );
}
