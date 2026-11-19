import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, History, Trash2 } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { BalanceChart } from '../components/charts';
import { listAccounts, saveAccount, deleteAccount, deletePerson, personSummary, findMissingCounterparts, applyMissingCounterparts, type MissingCounterpart, listSnapshots, saveSnapshot, deleteSnapshot } from '../db/repo';
import { balanceTrend } from '../db/reports';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../db/types';
import { useTxDialog } from '../components/Layout';
import { formatDate, parseDate, today, currentMonth, addMonths } from '../lib/dates';
import { formatCents } from '../lib/money';

export default function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useQuery((b) => listAccounts(b, showArchived), [showArchived]);
  const [owner, setOwner] = useState<string | null>(null); // null = alle
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [history, setHistory] = useState<Account | null>(null);
  const [missing, setMissing] = useState<MissingCounterpart[] | null>(null);
  const { openNew } = useTxDialog();
  const book = useBook();
  const removePerson = (o: string) => {
    const s = personSummary(book, o);
    const parts = [`${s.accounts} Konten`, `${s.transactions} Buchungen`, `${s.snapshots} Kontostände`, `${s.holdings} Depotpositionen`, `${s.pensions} Vorsorge-Einträge`];
    if (!window.confirm(`Alles von „${o}“ löschen?\n\n${parts.join(', ')}.\n\nVerträge bleiben erhalten. Umbuchungen zu diesen Konten werden auf den übrigen Konten zu normalen Buchungen. Das lässt sich nicht rückgängig machen. Lege vorher eine Sicherung an.`)) return;
    deletePerson(book, o);
    setOwner(null);
  };
  const owners = useMemo(() => [...new Set(accounts.map((a) => a.owner ?? ''))].sort(), [accounts]);
  const shown = accounts.filter((a) => owner === null || (a.owner ?? '') === owner);
  const groups = owners.filter((o) => owner === null || o === owner).map((o) => ({ owner: o, items: shown.filter((a) => (a.owner ?? '') === o) }));
  const total = shown.filter((a) => !a.archived && !a.external).reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <PageHeader title="Konten" subtitle={`${shown.filter((a) => !a.archived).length} aktive Konten`} actions={
        <>
          <button className="btn-secondary" onClick={() => setMissing(findMissingCounterparts(book))}>Fehlende Gegenbuchungen ergänzen</button>
          <button className="btn-secondary" onClick={() => openNew('transfer')}>Umbuchung</button>
          <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Konto anlegen</button>
        </>
      } />
      {owners.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Person">
          {[null, ...owners].map((o) => (
            <button key={o ?? '*'} role="tab" aria-selected={owner === o} onClick={() => setOwner(o)}
              className={`px-3 h-8 rounded-full text-sm border ${owner === o ? 'bg-accent text-on-accent border-accent' : 'border-border bg-surface hover:bg-surface-2'}`}>
              {o === null ? 'Alle' : o || 'Ohne Inhaber'}
            </button>
          ))}
        </div>
      )}
      {accounts.length === 0 && <div className="card"><Empty title="Noch keine Konten" action={<button className="btn-primary" onClick={() => setEdit('new')}>Konto anlegen</button>} /></div>}
      <div className="space-y-4">
        {groups.map((g) => {
          const sub = g.items.filter((a) => !a.archived && !a.external).reduce((s, a) => s + a.balance, 0);
          return (
            <section key={g.owner || '-'} className="card divide-y divide-border">
              {owners.length > 1 && (
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface-2 rounded-t-lg">
                  <h2 className="font-semibold text-sm">{g.owner || 'Ohne Inhaber'}</h2>
                  <div className="flex items-center gap-2">
                    <Money cents={sub} className="font-semibold text-sm" />
                    {g.owner && (
                      <button className="btn-ghost h-7 px-2 text-text-muted hover:text-danger" title={`Konten von ${g.owner} löschen`} aria-label={`Konten von ${g.owner} löschen`} onClick={() => removePerson(g.owner)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {g.items.map((a) => (
                <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${a.archived ? 'opacity-60' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <Link to={`/buchungen?konto=${a.id}`} className="font-medium hover:underline">{a.bank ? `${a.bank} · ` : ''}{a.name}</Link>
                    <div className="text-xs text-text-muted">
                      {[ACCOUNT_TYPES[a.type], a.interest_rate ? `${(a.interest_rate * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} % Zinsen` : null,
                        a.exemption ? `Freistellung ${formatCents(a.exemption)}${a.exemption_used != null ? `, verbraucht ${formatCents(a.exemption_used)}` : ''}` : null,
                        a.balance_date ? `Stand ${formatDate(a.balance_date)}` : null, a.external ? 'extern' : null, a.archived ? 'archiviert' : null].filter(Boolean).join(' · ')}
                    </div>
                    {a.note && <div className="text-xs text-warning">{a.note}</div>}
                  </div>
                  <Money cents={a.balance} className="font-semibold" />
                  <button className="btn-ghost w-9 px-0" aria-label={`Kontostände von ${a.name}`} title="Kontostände" onClick={() => setHistory(a)}><History size={16} /></button>
                  <button className="btn-ghost w-9 px-0" aria-label={`${a.name} bearbeiten`} onClick={() => setEdit(a)}><Pencil size={16} /></button>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {accounts.length > 0 && (
        <div className="card flex items-center justify-between px-4 py-3 mt-4">
          <span className="text-sm font-medium">Summe {owner === null ? 'aller aktiven Konten' : owner || 'ohne Inhaber'}</span>
          <Money cents={total} className="font-semibold" />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-text-muted mt-3">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte Konten zeigen
      </label>
      {missing && <MissingDialog items={missing} onClose={() => setMissing(null)} />}
      {edit && <AccountDialog account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} owners={owners.filter(Boolean)} />}
      {history && <HistoryDialog account={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function HistoryDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const book = useBook();
  const snaps = useQuery((b) => listSnapshots(b, account.id), [account.id]);
  const first = snaps[0]?.date.slice(0, 7) ?? addMonths(currentMonth(), -11);
  const trend = useQuery((b) => balanceTrend(b, first < addMonths(currentMonth(), -36) ? addMonths(currentMonth(), -36) : first, currentMonth(), account.id), [account.id, first, snaps.length]);
  const [date, setDate] = useState(formatDate(today()));
  const [amount, setAmount] = useState<number | null>(null);
  const [negative, setNegative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    setError(null);
    try {
      const d = parseDate(date);
      if (!d) throw new Error('Bitte ein gültiges Datum eingeben.');
      if (amount == null) throw new Error('Bitte einen Kontostand eingeben.');
      saveSnapshot(book, account.id, d, (negative ? -1 : 1) * amount);
      setAmount(null);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={`Kontostände: ${account.bank ? account.bank + ' · ' : ''}${account.name}`} onClose={onClose} wide footer={<button className="btn-primary" onClick={onClose}>Fertig</button>}>
      <p className="text-sm text-text-muted mb-3">Für Depots oder Konten ohne einzelne Buchungen kannst du hier den Kontostand zu einem Stichtag erfassen. Der neueste Stand zählt, spätere Buchungen werden dazugerechnet.</p>
      {snaps.length > 1 && <BalanceChart data={trend} height={180} />}
      <form className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end my-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="Stichtag"><input className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Kontostand"><AmountInput value={amount} onChange={setAmount} /></Field>
        <label className="flex items-center gap-1 text-sm h-9"><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />Minus</label>
        <button className="btn-primary" type="submit">Erfassen</button>
      </form>
      <ErrorNote error={error} />
      <ul className="divide-y divide-border text-sm">
        {[...snaps].reverse().map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-1.5">
            <span className="tabular-nums text-text-muted w-24">{formatDate(s.date)}</span>
            <Money cents={s.balance} className="flex-1" />
            <button className="btn-ghost w-8 h-8 px-0" aria-label="Kontostand löschen" onClick={() => deleteSnapshot(book, s.id)}><Trash2 size={14} /></button>
          </li>
        ))}
        {!snaps.length && <li className="py-2 text-text-muted">Noch keine Kontostände erfasst.</li>}
      </ul>
    </Modal>
  );
}

function AccountDialog({ account, onClose, owners }: { account: Account | null; onClose: () => void; owners: string[] }) {
  const book = useBook();
  const [name, setName] = useState(account?.name ?? '');
  const [bank, setBank] = useState(account?.bank ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [owner, setOwner] = useState(account?.owner ?? '');
  const [iban, setIban] = useState(account?.iban ?? '');
  const [opening, setOpening] = useState<number | null>(account ? Math.abs(account.opening_balance) : 0);
  const [negative, setNegative] = useState((account?.opening_balance ?? 0) < 0);
  const [rate, setRate] = useState(account?.interest_rate != null ? String(account.interest_rate * 100).replace('.', ',') : '');
  const [exemption, setExemption] = useState<number | null>(account?.exemption ?? null);
  const [used, setUsed] = useState<number | null>(account?.exemption_used ?? null);
  const [note, setNote] = useState(account?.note ?? '');
  const [archived, setArchived] = useState(!!account?.archived);
  const [external, setExternal] = useState(!!account?.external);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      const r = rate.trim() ? Number(rate.replace(',', '.')) / 100 : null;
      if (r != null && Number.isNaN(r)) throw new Error('Ungültiger Zinssatz.');
      saveAccount(book, {
        id: account?.id, name, type, owner: owner || null, bank: bank || null, iban: iban.replace(/\s/g, '') || null,
        opening_balance: (negative ? -1 : 1) * (opening ?? 0), archived, external, interest_rate: r, exemption, exemption_used: used, note: note || null,
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = () => {
    if (account && window.confirm(`Konto „${account.name}“ mit allen Buchungen löschen? Das lässt sich nicht rückgängig machen.`)) {
      deleteAccount(book, account.id);
      onClose();
    }
  };

  return (
    <Modal title={account ? 'Konto bearbeiten' : 'Konto anlegen'} onClose={onClose} wide footer={
      <>
        {account && <button className="btn-ghost text-danger mr-auto" onClick={remove}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Kontoname"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Bank"><input className="input" value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
          <Field label="Kontoart">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Inhaber"><input className="input" list="acc-owners" value={owner} onChange={(e) => setOwner(e.target.value)} /><datalist id="acc-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist></Field>
        </div>
        <Field label="IBAN (optional)"><input className="input" value={iban} onChange={(e) => setIban(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <Field label="Anfangssaldo" hint="Nur für Konten ohne erfasste Kontostände"><AmountInput value={opening} onChange={setOpening} /></Field>
          <label className="flex items-center gap-2 text-sm h-9 sm:mb-5"><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> im Minus</label>
          <Field label="Zinssatz in %"><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="z. B. 1,8" /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Freistellungsauftrag"><AmountInput value={exemption} onChange={setExemption} /></Field>
          <Field label="davon verbraucht"><AmountInput value={used} onChange={setUsed} /></Field>
        </div>
        <Field label="Bemerkung"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} /> Externes Konto (nur Gegenkonto für Durchbuchungen, zählt nicht zum Vermögen)</label>
        {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Konto archivieren (wird ausgeblendet)</label>}
        <button type="submit" hidden />
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function MissingDialog({ items, onClose }: { items: MissingCounterpart[]; onClose: () => void }) {
  const book = useBook();
  const [done, setDone] = useState<{ linked: number; created: number } | null>(null);
  const todo = items.filter((i) => i.action !== 'skip');
  const skipped = items.filter((i) => i.action === 'skip');
  const label = { link: 'verknüpfen', create: 'anlegen', skip: 'nicht möglich' } as const;
  return (
    <Modal title="Fehlende Gegenbuchungen" onClose={onClose} wide footer={
      done ? <button className="btn-primary" onClick={onClose}>Fertig</button> : (
        <>
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={!todo.length} onClick={() => setDone(applyMissingCounterparts(book, todo))}>{todo.length} Gegenbuchungen ergänzen</button>
        </>
      )
    }>
      {done ? (
        <p className="text-sm">{done.linked} Buchungen wurden mit einer vorhandenen Gegenbuchung verknüpft, {done.created} Gegenbuchungen neu angelegt. Neu angelegte sind als „automatisch ergänzt“ markiert und werden beim nächsten Import des Gegenkontos durch die Buchung der Bank ersetzt.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-text-muted">Gesucht werden Buchungen, deren Gegenseite laut Bank (IBAN) ein eigenes Konto ist, die aber noch nicht als Umbuchung erfasst sind.</p>
          {!items.length && <p>Alle Überweisungen zwischen eigenen Konten haben schon eine Gegenbuchung.</p>}
          {items.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left"><tr><th className="px-2 py-1">Datum</th><th className="px-2 py-1">Konto</th><th className="px-2 py-1">Gegenkonto</th><th className="px-2 py-1 text-right">Betrag</th><th className="px-2 py-1">Aktion</th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.txId} className={`border-t border-border ${i.action === 'skip' ? 'text-text-muted' : ''}`} title={i.reason ?? undefined}>
                      <td className="px-2 py-1 whitespace-nowrap">{formatDate(i.date)}</td><td className="px-2 py-1">{i.accountName}</td><td className="px-2 py-1">{i.targetName}</td>
                      <td className="px-2 py-1 text-right"><Money cents={i.amount} /></td><td className="px-2 py-1">{label[i.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {skipped.length > 0 && <p className="text-warning">{skipped.length} Buchungen werden nicht ergänzt: Im Gegenkonto ist der Zeitraum schon per Bankimport erfasst, die Buchung fehlt dort aber. Bitte prüfen.</p>}
        </div>
      )}
    </Modal>
  );
}
