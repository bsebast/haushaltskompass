import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Bar, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import CategorySelect from '../components/CategorySelect';
import { budgetStatus, type BudgetStatus } from '../db/reports';
import { saveBudget, deleteBudget } from '../db/repo';
import { currentMonth, addMonths, monthLabel } from '../lib/dates';

export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const rows = useQuery((b) => budgetStatus(b, month), [month]);
  const [edit, setEdit] = useState<BudgetStatus | 'new' | null>(null);
  const monthly = rows.filter((r) => r.budget.period === 'month');
  const limit = monthly.reduce((a, r) => a + r.limit, 0);
  const spent = monthly.reduce((a, r) => a + r.spent, 0);

  return (
    <>
      <PageHeader title="Budgets" subtitle="Lege Obergrenzen je Kategorie fest und sieh, ob du im Rahmen bleibst." actions={
        <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Budget anlegen</button>
      } />
      <div className="flex items-center gap-2 mb-4">
        <button className="btn-secondary w-9 px-0" aria-label="Vorheriger Monat" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
        <span className="font-medium w-36 text-center">{monthLabel(month, true)}</span>
        <button className="btn-secondary w-9 px-0" aria-label="Nächster Monat" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
        {month !== currentMonth() && <button className="btn-ghost" onClick={() => setMonth(currentMonth())}>Heute</button>}
      </div>
      {rows.length === 0 ? (
        <div className="card"><Empty title="Noch keine Budgets" text="Ein Budget ist ein Monats- oder Jahreslimit für eine Kategorie, zum Beispiel 500 € für Lebensmittel." action={<button className="btn-primary" onClick={() => setEdit('new')}>Erstes Budget anlegen</button>} /></div>
      ) : (
        <>
          {monthly.length > 0 && (
            <div className="card p-5 mb-4">
              <div className="flex justify-between text-sm mb-2"><span className="font-medium">Alle Monatsbudgets</span><span><Money cents={spent} colored={false} /> von <Money cents={limit} colored={false} /></span></div>
              <Bar ratio={limit ? spent / limit : 0} state={spent > limit ? 'over' : spent > limit * 0.9 ? 'warn' : 'ok'} />
            </div>
          )}
          <div className="card divide-y divide-border">
            {rows.map((s) => (
              <button key={s.budget.id} className="w-full text-left px-4 py-3 hover:bg-surface-2" onClick={() => setEdit(s)}>
                <div className="flex flex-wrap justify-between gap-2 mb-1.5">
                  <span className="font-medium">{s.category.name} <span className="text-xs text-text-muted">{s.budget.period === 'month' ? 'monatlich' : 'jährlich'}</span></span>
                  <span className="text-sm tabular-nums">
                    <Money cents={s.spent} colored={false} /> von <Money cents={s.limit} colored={false} />
                    <span className={`ml-2 text-xs ${s.state === 'over' ? 'text-danger' : s.state === 'warn' ? 'text-warning' : 'text-text-muted'}`}>
                      {s.state === 'over' ? `${formatPct(s.ratio - 1)} drüber` : `noch ${formatEuro(s.limit - s.spent)}`}
                    </span>
                  </span>
                </div>
                <Bar ratio={s.ratio} state={s.state} />
                {s.expectedRatio !== null && s.state === 'warn' && s.ratio <= 1 && (
                  <p className="text-xs text-warning mt-1">Schneller verbraucht als der Zeitraum fortgeschritten ist ({formatPct(s.ratio)} bei {formatPct(s.expectedRatio)} der Zeit).</p>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-3">Budgets einer Oberkategorie zählen alle Unterkategorien mit. <Link to="/auswertungen" className="text-accent hover:underline">Zur Auswertung</Link></p>
        </>
      )}
      {edit && <BudgetDialog status={edit === 'new' ? null : edit} onClose={() => setEdit(null)} month={month} />}
    </>
  );
}

const formatPct = (r: number) => `${Math.round(r * 100)} %`;
const formatEuro = (c: number) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function BudgetDialog({ status, onClose, month }: { status: BudgetStatus | null; onClose: () => void; month: string }) {
  const book = useBook();
  const [category, setCategory] = useState<string | null>(status?.category.id ?? null);
  const [period, setPeriod] = useState<'month' | 'year'>(status?.budget.period ?? 'month');
  const [amount, setAmount] = useState<number | null>(status?.limit ?? null);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    try {
      if (!category) throw new Error('Bitte eine Kategorie wählen.');
      if (!amount) throw new Error('Bitte einen Betrag eingeben.');
      saveBudget(book, { id: status?.budget.id, category_id: category, period, amount, valid_from: status?.budget.valid_from ?? `${month.slice(0, 4)}-01` });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={status ? 'Budget bearbeiten' : 'Budget anlegen'} onClose={onClose} footer={
      <>
        {status && <button className="btn-ghost text-danger mr-auto" onClick={() => { deleteBudget(book, status.budget.id); onClose(); }}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Kategorie"><CategorySelect value={category} onChange={setCategory} kind="expense" allowEmpty={false} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zeitraum">
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as 'month' | 'year')}>
              <option value="month">Monatlich</option><option value="year">Jährlich</option>
            </select>
          </Field>
          <Field label="Limit"><AmountInput value={amount} onChange={setAmount} /></Field>
        </div>
        <button type="submit" hidden />
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
