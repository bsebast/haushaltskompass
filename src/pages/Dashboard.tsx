import { Link } from 'react-router-dom';
import { useQuery } from '../state';
import { Money, Bar, Dot, Empty } from '../components/ui';
import { BalanceChart, DonutChart, IncomeExpenseChart } from '../components/charts';
import { listAccounts, listTransactions } from '../db/repo';
import { monthLeft, balanceTrend, budgetStatus, categoryTotals, monthlyTotals, savingHints } from '../db/reports';
import { currentMonth, addMonths, monthRange, monthLabel, formatDate } from '../lib/dates';
import { ACCOUNT_TYPES } from '../db/types';
import { useTxDialog } from '../components/Layout';

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

export default function Dashboard() {
  const m = currentMonth();
  const r = monthRange(m);
  const left = useQuery((b) => monthLeft(b, m), [m]);
  const accounts = useQuery((b) => listAccounts(b));
  const trend = useQuery((b) => balanceTrend(b, addMonths(m, -11), m), [m]);
  const totals = useQuery((b) => monthlyTotals(b, addMonths(m, -5), m), [m]);
  const budgets = useQuery((b) => budgetStatus(b, m), [m]);
  const topCats = useQuery((b) => categoryTotals(b, r.from, r.to, 'expense'), [r.from]);
  const recent = useQuery((b) => listTransactions(b, { limit: 8 }));
  const hints = useQuery((b) => savingHints(b, m), [m]);
  const open = useQuery((b) => listTransactions(b, { uncategorized: true }).length);
  const { openNew } = useTxDialog();
  const total = accounts.reduce((s, a) => s + a.balance, 0);

  if (!recent.length) {
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
          <div><dt className="text-text-muted text-xs">Einnahmen</dt><dd><Money cents={left.income} /></dd></div>
          <div><dt className="text-text-muted text-xs">Ausgaben</dt><dd><Money cents={-left.expense} /></dd></div>
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
        <BalanceChart data={trend} />
      </Card>

      <Card title="Ausgaben nach Kategorie" link={['/auswertungen', 'Details']}>
        {topCats.length === 0 ? <p className="text-sm text-text-muted">Diesen Monat noch keine Ausgaben.</p> : (
          <>
            <DonutChart data={topCats.slice(0, 8)} height={160} />
            <ul className="mt-2 space-y-1 text-sm">
              {topCats.slice(0, 5).map((c) => (
                <li key={c.category_id ?? 'none'} className="flex items-center gap-2">
                  <Dot color={c.color} /><span className="flex-1 truncate">{c.name}</span>
                  <span className="text-text-muted text-xs">{Math.round(c.share * 100)} %</span>
                  <Money cents={c.amount} colored={false} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Einnahmen und Ausgaben" className="md:col-span-2">
        <IncomeExpenseChart data={totals} height={220} />
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
