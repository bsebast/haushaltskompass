import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { listAccounts } from '../db/repo';
import { ACCOUNT_TYPES } from '../db/types';
import { deleteGoal, depositGoal, GOAL_COLORS, goalColor, goalProgress, listGoals, saveGoal, type GoalProgress, type SavingsGoal } from '../db/goals';
import { formatDate, monthLabel } from '../lib/dates';
import { formatCents } from '../lib/money';

export default function Goals() {
  const goals = useQuery((b) => goalProgress(b, listGoals(b)));
  const [edit, setEdit] = useState<SavingsGoal | 'new' | null>(null);
  const [deposit, setDeposit] = useState<SavingsGoal | null>(null);
  const active = goals.filter((p) => !p.goal.done);
  const done = goals.filter((p) => p.goal.done);
  const sum = (k: 'current' | 'remaining') => active.reduce((a, p) => a + p[k], 0);
  const needed = active.reduce((a, p) => a + (p.perMonth ?? 0), 0);

  return (
    <>
      <PageHeader title="Sparziele" subtitle="Wofür du sparst, wie weit du bist und wie viel im Monat dafür nötig ist."
        actions={<button className="btn-primary" onClick={() => setEdit('new')}><Plus size={14} /> Sparziel</button>} />
      {goals.length === 0 ? (
        <div className="card"><Empty title="Noch keine Sparziele" text="Lege ein Ziel mit Betrag und, wenn du magst, einem Datum an, z. B. Notgroschen, Urlaub oder ein neues Fahrrad. Den Stand trägst du von Hand ein oder verknüpfst ein Sparkonto."
          action={<button className="btn-primary" onClick={() => setEdit('new')}>Erstes Sparziel anlegen</button>} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi label="Offene Ziele">{active.length}</Kpi>
            <Kpi label="Schon angespart"><Money cents={sum('current')} colored={false} /></Kpi>
            <Kpi label="Fehlt noch"><Money cents={sum('remaining')} colored={false} /></Kpi>
            <Kpi label="Nötig im Monat" hint="für alle Ziele mit Datum"><Money cents={needed} colored={false} /></Kpi>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {active.map((p, i) => <GoalCard key={p.goal.id} p={p} index={i} onEdit={() => setEdit(p.goal)} onDeposit={() => setDeposit(p.goal)} />)}
          </div>
          {done.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-text-muted mb-2">Abgeschlossen</h2>
              <ul className="card divide-y divide-border">
                {done.map((p) => (
                  <li key={p.goal.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <Check size={15} className="text-success" aria-hidden />
                    <button className="flex-1 text-left truncate hover:underline" onClick={() => setEdit(p.goal)}>{p.goal.name}</button>
                    <Money cents={p.goal.target} colored={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {edit && <GoalDialog goal={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {deposit && <DepositDialog goal={deposit} onClose={() => setDeposit(null)} />}
    </>
  );
}

function Kpi({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="card p-5"><div className="text-xs text-text-muted">{label}</div><div className="text-xl font-semibold mt-1">{children}</div>{hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}</div>;
}

function GoalCard({ p, index, onEdit, onDeposit }: { p: GoalProgress; index: number; onEdit: () => void; onDeposit: () => void }) {
  const g = p.goal;
  const color = goalColor(g, index);
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{g.name}</h2>
          <p className="text-xs text-text-muted">
            {g.account_id ? <>Stand aus Konto <Link to={`/buchungen?konto=${g.account_id}`} className="hover:underline">{g.account_name}</Link></> : 'Stand von Hand'}
            {g.target_date && ` · Ziel bis ${formatDate(g.target_date)}`}
          </p>
        </div>
        <div className="text-2xl font-semibold tabular-nums" style={{ color }}>{Math.round(p.ratio * 100)} %</div>
      </div>
      <div className="h-3 rounded-full bg-surface-2 overflow-hidden mt-3" role="progressbar" aria-label={g.name} aria-valuenow={Math.round(p.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full" style={{ width: `${p.ratio * 100}%`, background: color }} />
      </div>
      <div className="flex justify-between text-sm mt-1.5">
        <span><Money cents={p.current} colored={false} className="font-medium" /> <span className="text-text-muted">von {formatCents(g.target)}</span></span>
        {!p.reached && <span className="text-text-muted">fehlt <Money cents={p.remaining} colored={false} /></span>}
      </div>
      <ul className="mt-3 space-y-1 text-xs text-text-muted">
        {p.reached && <li className="text-success font-medium">Ziel erreicht. Du kannst es unter „Bearbeiten“ als abgeschlossen markieren.</li>}
        {p.overdue && <li className="text-warning">Das Zieldatum ist vorbei. Passe Datum oder Betrag an.</li>}
        {p.perMonth !== null && <li>Nötig: <span className="text-text font-medium">{formatCents(p.perMonth)}</span> im Monat für {p.monthsLeft} {p.monthsLeft === 1 ? 'Monat' : 'Monate'}</li>}
        {p.pace !== null && (
          <li>Bisheriges Tempo: {p.pace > 0 ? '+' : ''}{formatCents(p.pace)} im Monat (Ø 6 Monate)
            {p.eta && <> · erreicht etwa im <span className="text-text font-medium">{monthLabel(p.eta, true)}</span></>}</li>
        )}
        {g.note && <li>{g.note}</li>}
      </ul>
      <div className="flex gap-2 mt-4">
        {!g.account_id && <button className="btn-secondary" onClick={onDeposit}>Einzahlen / Entnehmen</button>}
        <button className="btn-ghost" onClick={onEdit}>Bearbeiten</button>
      </div>
    </section>
  );
}

function GoalDialog({ goal, onClose }: { goal: SavingsGoal | null; onClose: () => void }) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b).filter((a) => !a.external));
  const count = useQuery((b) => (b.value<number>('select count(*) from savings_goals') ?? 0) as number);
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState<number | null>(goal?.target ?? null);
  const [saved, setSaved] = useState<number | null>(goal?.saved ?? null);
  const [date, setDate] = useState(goal?.target_date ?? '');
  const [account, setAccount] = useState(goal?.account_id ?? '');
  const [color, setColor] = useState<string>(goal?.color ?? GOAL_COLORS[count % GOAL_COLORS.length]);
  const [note, setNote] = useState(goal?.note ?? '');
  const [done, setDone] = useState(!!goal?.done);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      saveGoal(book, { id: goal?.id, name, target: target ?? 0, target_date: date || null, saved: saved ?? 0, account_id: account || null, color, note, done });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = () => {
    if (goal && window.confirm(`Sparziel „${goal.name}“ löschen? Buchungen und Konten bleiben unverändert.`)) { deleteGoal(book, goal.id); onClose(); }
  };

  return (
    <Modal title={goal ? 'Sparziel bearbeiten' : 'Sparziel anlegen'} onClose={onClose} footer={<>
      {goal && <button className="btn-ghost text-danger mr-auto" onClick={remove}>Löschen</button>}
      <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
      <button className="btn-primary" onClick={save}>Speichern</button>
    </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Notgroschen, Sommerurlaub" maxLength={80} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Zielbetrag"><AmountInput value={target} onChange={setTarget} ariaLabel="Zielbetrag" /></Field>
          <Field label="Zieldatum" hint="optional"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Stand kommt aus" hint={account ? 'Der Kontostand zählt als angespart.' : 'Du trägst Einzahlungen von Hand ein.'}>
          <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">von Hand eintragen</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPES[a.type]}{a.owner ? `, ${a.owner}` : ''})</option>)}
          </select>
        </Field>
        {!account && <Field label="Schon angespart"><AmountInput value={saved} onChange={setSaved} ariaLabel="Schon angespart" /></Field>}
        <div>
          <span className="label">Farbe</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Farbe">
            {GOAL_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Farbe ${c.slice(1)}`} onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-text' : 'border-transparent'}`} style={{ background: `rgb(var(--c-${c}))` }} />
            ))}
          </div>
        </div>
        <Field label="Notiz"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {goal && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Abgeschlossen (z. B. Geld ausgegeben)</label>}
      </form>
      <ErrorNote error={error} />
    </Modal>
  );
}

function DepositDialog({ goal, onClose }: { goal: SavingsGoal; onClose: () => void }) {
  const book = useBook();
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (sign: 1 | -1) => {
    try { depositGoal(book, goal.id, sign * (amount ?? 0)); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={`${goal.name}: Stand ändern`} onClose={onClose} footer={<>
      <button className="btn-secondary mr-auto" onClick={onClose}>Abbrechen</button>
      <button className="btn-secondary" onClick={() => go(-1)}>Entnehmen</button>
      <button className="btn-primary" onClick={() => go(1)}>Einzahlen</button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); go(1); }}>
        <p className="text-sm text-text-muted mb-3">Aktuell angespart: <Money cents={goal.saved} colored={false} className="text-text font-medium" /></p>
        <Field label="Betrag"><AmountInput value={amount} onChange={setAmount} ariaLabel="Betrag" autoFocus /></Field>
      </form>
      <ErrorNote error={error} />
    </Modal>
  );
}
