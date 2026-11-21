import { useMemo, useState } from 'react';
import { Plus, Upload, Pencil } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty, Dot } from '../components/ui';
import AmountInput from '../components/AmountInput';
import CategorySelect from '../components/CategorySelect';
import { listAccounts } from '../db/repo';
import {
  listContracts, saveContract, deleteContract, perMonth, perYear, nextDue, upcoming, INTERVALS,
  parseContractsCsv, commitContracts, parseDue, type Contract, type Interval, type ImportRow,
} from '../db/contracts';
import { formatDate } from '../lib/dates';

export default function Contracts() {
  const [showEnded, setShowEnded] = useState(false);
  const all = useQuery((b) => listContracts(b, showEnded), [showEnded]);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [deathOnly, setDeathOnly] = useState(false);
  const [edit, setEdit] = useState<Contract | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const persons = useMemo(() => [...new Set(all.map((c) => c.person).filter(Boolean) as string[])].sort(), [all]);
  const kinds = useMemo(() => [...new Set(all.map((c) => c.kind).filter(Boolean) as string[])].sort(), [all]);
  const rows = all.filter((c) =>
    (!person || c.person === person) && (!kind || c.kind === kind) && (!deathOnly || (!!c.death_action && c.death_action !== '-')) &&
    (!search || `${c.name} ${c.purpose ?? ''} ${c.note ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const active = rows.filter((c) => c.status === 'confirmed');
  const monthly = active.reduce((a, c) => a + perMonth(c), 0);
  const yearly = active.reduce((a, c) => a + perYear(c), 0);
  const soon = upcoming(active, 30);
  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    active.forEach((c) => m.set(c.kind ?? 'Ohne Art', (m.get(c.kind ?? 'Ohne Art') ?? 0) + perMonth(c)));
    return [...m.entries()].sort((a, b) => a[1] - b[1]);
  }, [active]);

  return (
    <>
      <PageHeader title="Verträge & Fixkosten" subtitle="Versicherungen, Abos, Gebühren und Daueraufträge mit Rhythmus und Fälligkeit." actions={
        <>
          <button className="btn-secondary" onClick={() => setImporting(true)}><Upload size={16} />Importieren</button>
          <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Vertrag</button>
        </>
      } />

      {all.length === 0 ? (
        <div className="card"><Empty title="Noch keine Verträge" text="Lege Verträge einzeln an oder importiere eine CSV-Liste, zum Beispiel aus deiner Excel-Übersicht."
          action={<button className="btn-primary" onClick={() => setImporting(true)}>CSV importieren</button>} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="card p-5"><div className="text-xs text-text-muted">Fixkosten pro Monat (Ø)</div><div className="text-xl font-semibold mt-1"><Money cents={monthly} /></div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Pro Jahr</div><div className="text-xl font-semibold mt-1"><Money cents={yearly} /></div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Aktive Verträge</div><div className="text-xl font-semibold mt-1">{active.length}</div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Fällig in 30 Tagen</div><div className="text-xl font-semibold mt-1"><Money cents={soon.reduce((a, s) => a + s.contract.amount, 0)} /></div></div>
          </div>

          <div className="grid gap-4 2xl:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <div className="card p-3 mb-3 grid gap-2 sm:grid-cols-[1fr_160px_180px]">
                <input className="input" placeholder="Suchen …" aria-label="Verträge durchsuchen" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="input" aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Alle Personen</option>{persons.map((p) => <option key={p}>{p}</option>)}
                </select>
                <select className="input" aria-label="Art" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">Alle Arten</option>{kinds.map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-surface-2 text-xs text-text-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Vertrag</th>
                      <th className="text-left px-2 py-2 font-medium">Person</th>
                      <th className="text-left px-2 py-2 font-medium">Kategorie</th>
                      <th className="text-right px-2 py-2 font-medium">Betrag</th>
                      <th className="text-left px-2 py-2 font-medium">Rhythmus</th>
                      <th className="text-left px-2 py-2 font-medium">Nächste</th>
                      <th className="text-right px-2 py-2 font-medium">Ø Monat</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((c) => {
                      const nd = c.status === 'confirmed' ? nextDue(c) : null;
                      return (
                        <tr key={c.id} className={c.status === 'ended' ? 'opacity-50' : ''}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-text-muted">{[c.purpose, c.kind, c.payment_method].filter(Boolean).join(' · ')}</div>
                            {c.note && <div className="text-xs text-warning">{c.note}</div>}
                            {(c.death_action || c.notice_period || c.doc_ref) && <div className="text-xs text-text-muted">{[c.notice_period ? `Kündigungsfrist ${c.notice_period}` : null, c.death_action ? `Todesfall: ${c.death_action}` : null, c.doc_ref ? `Ablage ${c.doc_ref}` : null, c.advisor ? `über ${c.advisor}` : null].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{c.person ?? '–'}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{c.category_name ? <span className="inline-flex items-center gap-1.5"><Dot color={c.category_color} />{c.category_name}</span> : <span className="text-text-muted">–</span>}</td>
                          <td className="px-2 py-2 text-right"><Money cents={c.amount} /></td>
                          <td className="px-2 py-2 whitespace-nowrap">{INTERVALS[c.interval]}</td>
                          <td className="px-2 py-2 whitespace-nowrap tabular-nums">{c.status === 'ended' ? 'beendet' : nd ? formatDate(nd) : '–'}</td>
                          <td className="px-2 py-2 text-right text-text-muted"><Money cents={perMonth(c)} colored={false} /></td>
                          <td className="px-2"><button className="btn-ghost w-8 h-8 px-0" aria-label={`${c.name} bearbeiten`} onClick={() => setEdit(c)}><Pencil size={15} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-2 font-medium">
                      <td colSpan={6} className="px-3 py-2">{active.length} aktive Verträge in dieser Ansicht</td>
                      <td className="px-2 py-2 text-right"><Money cents={monthly} /></td><td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <label className="flex items-center gap-2 text-sm text-text-muted mt-3">
                <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Beendete Verträge zeigen
              </label>
              <label className="flex items-center gap-2 text-sm text-text-muted mt-1">
                <input type="checkbox" checked={deathOnly} onChange={(e) => setDeathOnly(e.target.checked)} /> Nur Verträge mit Aktion im Todesfall (Checkliste)
              </label>
            </div>

            <aside className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1 content-start">
              <section className="card p-5">
                <h2 className="text-sm font-semibold mb-3">Fällig in den nächsten 30 Tagen</h2>
                {soon.length === 0 ? <p className="text-sm text-text-muted">Nichts fällig.</p> : (
                  <ul className="space-y-2 text-sm">
                    {soon.map(({ contract: c, date }) => (
                      <li key={c.id} className="flex gap-2">
                        <span className="tabular-nums text-text-muted w-20 shrink-0">{formatDate(date)}</span>
                        <span className="flex-1 truncate">{c.name}{c.person ? ` (${c.person})` : ''}</span>
                        <Money cents={c.amount} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card p-5">
                <h2 className="text-sm font-semibold mb-3">Ø pro Monat nach Art</h2>
                <ul className="space-y-1.5 text-sm">
                  {byKind.map(([k, v]) => (
                    <li key={k} className="flex justify-between"><button className="hover:underline text-left" onClick={() => setKind(k === 'Ohne Art' ? '' : k)}>{k}</button><Money cents={v} colored={false} /></li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}
      {edit && <ContractDialog contract={edit === 'new' ? null : edit} onClose={() => setEdit(null)} kinds={kinds} persons={persons} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function ContractDialog({ contract: c, onClose, kinds, persons }: { contract: Contract | null; onClose: () => void; kinds: string[]; persons: string[] }) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b));
  const [name, setName] = useState(c?.name ?? '');
  const [person, setPerson] = useState(c?.person ?? '');
  const [purpose, setPurpose] = useState(c?.purpose ?? '');
  const [kind, setKind] = useState(c?.kind ?? '');
  const [amount, setAmount] = useState<number | null>(c ? Math.abs(c.amount) : null);
  const [income, setIncome] = useState((c?.amount ?? -1) > 0);
  const [interval, setInterval] = useState<Interval>(c?.interval ?? 'monthly');
  const [due, setDue] = useState(c ? formatDue(c) : '');
  const [category, setCategory] = useState<string | null>(c?.category_id ?? null);
  const [account, setAccount] = useState<string>(c?.account_id ?? '');
  const [payment, setPayment] = useState(c?.payment_method ?? '');
  const [note, setNote] = useState(c?.note ?? '');
  const [ended, setEnded] = useState(c?.status === 'ended');
  const [notice, setNotice] = useState(c?.notice_period ?? '');
  const [docRef, setDocRef] = useState(c?.doc_ref ?? '');
  const [advisor, setAdvisor] = useState(c?.advisor ?? '');
  const [deathAction, setDeathAction] = useState(c?.death_action ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      if (!amount) throw new Error('Bitte einen Betrag eingeben.');
      const d = parseDue(due);
      saveContract(book, {
        id: c?.id, name, person: person || null, purpose: purpose || null, kind: kind || null, amount: (income ? 1 : -1) * amount, interval,
        due_day: d.day, due_months: d.months, category_id: category, account_id: account || null, payment_method: payment || null,
        note: note || null, notice_period: notice || null, doc_ref: docRef || null, advisor: advisor || null, death_action: deathAction || null,
        start_date: c?.start_date ?? null, status: ended ? 'ended' : 'confirmed', end_date: ended ? c?.end_date ?? new Date().toISOString().slice(0, 10) : null,
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title={c ? 'Vertrag bearbeiten' : 'Neuer Vertrag'} onClose={onClose} wide footer={
      <>
        {c && <button className="btn-ghost text-danger mr-auto" onClick={() => { if (window.confirm('Vertrag löschen?')) { deleteContract(book, c.id); onClose(); } }}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Vertrag / Anbieter"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Zweck"><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
          <Field label="Person"><input className="input" list="c-persons" value={person} onChange={(e) => setPerson(e.target.value)} /><datalist id="c-persons">{persons.map((p) => <option key={p} value={p} />)}</datalist></Field>
          <Field label="Art"><input className="input" list="c-kinds" value={kind} onChange={(e) => setKind(e.target.value)} /><datalist id="c-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="Betrag"><AmountInput value={amount} onChange={setAmount} /></Field>
          <Field label="Rhythmus">
            <select className="input" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
              {Object.entries(INTERVALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Fälligkeit" hint="z. B. 01. oder 15.02., 15.05."><input className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={income} onChange={(e) => setIncome(e.target.checked)} /> Regelmäßige Einnahme (z. B. Kindergeld)</label>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Kategorie"><CategorySelect value={category} onChange={setCategory} kind={income ? 'income' : 'expense'} /></Field>
          <Field label="Konto">
            <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">–</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Zahlart"><input className="input" list="c-pay" value={payment} onChange={(e) => setPayment(e.target.value)} />
            <datalist id="c-pay">{['Lastschrift', 'Dauerauftrag', 'Überweisung', 'Rechnung', 'Kreditkarte', 'PayPal'].map((p) => <option key={p} value={p} />)}</datalist></Field>
        </div>
        <Field label="Bemerkung"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Kündigungsfrist"><input className="input" value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="z. B. 3 Monate" /></Field>
          <Field label="Ablage-Nr."><input className="input" value={docRef} onChange={(e) => setDocRef(e.target.value)} /></Field>
          <Field label="Über Berater"><input className="input" value={advisor} onChange={(e) => setAdvisor(e.target.value)} /></Field>
          <Field label="Aktion im Todesfall"><input className="input" list="c-death" value={deathAction} onChange={(e) => setDeathAction(e.target.value)} />
            <datalist id="c-death">{['kündigen', 'umschreiben', 'Info an Versicherer, Auszahlung Todesfallleistung'].map((x) => <option key={x} value={x} />)}</datalist></Field>
        </div>
        {c && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} /> Vertrag ist beendet oder gekündigt</label>}
        <button type="submit" hidden />
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function formatDue(c: Contract) {
  if (!c.due_day) return '';
  const d = String(c.due_day).padStart(2, '0');
  if (!c.due_months) return `${d}.`;
  return c.due_months.split(',').map((m) => `${d}.${m.padStart(2, '0')}.`).join(', ');
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b));
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const buf = await f.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
      const r = parseContractsCsv(book, text);
      if (!r.length) throw new Error('In der Datei wurden keine Zeilen gefunden.');
      setRows(r);
    } catch (e) { setError((e as Error).message); }
  };
  const ok = rows?.filter((r) => !r.skip) ?? [];

  return (
    <Modal title="Verträge importieren" onClose={onClose} wide footer={
      done !== null ? <button className="btn-primary" onClick={onClose}>Fertig</button> : (
        <>
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={!ok.length} onClick={() => setDone(commitContracts(book, rows!, account || null))}>{ok.length} Verträge übernehmen</button>
        </>
      )
    }>
      {done !== null ? <p className="text-sm">{done} Verträge wurden übernommen.</p> : (
        <div className="space-y-3 text-sm">
          <p className="text-text-muted">CSV-Datei mit Semikolon oder Komma. Erkannte Spalten: Vertrag, Vertragspartner, Zweck, Betrag, Rhythmus, Fälligkeit, Zahlart, Art, Kategorie (z. B. „Versicherungen › Haftpflicht“), Bemerkung. Aus Excel: „Speichern unter“ → „CSV UTF-8“.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Datei"><input type="file" accept=".csv,text/csv" className="input py-1" onChange={(e) => read(e.target.files?.[0])} /></Field>
            <Field label="Abbuchungskonto für alle"><select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">–</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></Field>
          </div>
          {rows && (
            <div className="border border-border rounded-md max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 sticky top-0"><tr><th className="text-left p-2">Vertrag</th><th className="text-left p-2">Person</th><th className="text-right p-2">Betrag</th><th className="text-left p-2">Rhythmus</th><th className="text-left p-2">Kategorie</th><th className="text-left p-2">Hinweis</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.line} className={r.skip ? 'opacity-50' : ''}>
                      <td className="p-2">{r.input.name || '–'}</td><td className="p-2">{r.input.person}</td>
                      <td className="p-2 text-right"><Money cents={r.input.amount} /></td><td className="p-2">{INTERVALS[r.input.interval]}</td>
                      <td className="p-2">{r.categoryLabel}</td><td className={`p-2 ${r.skip ? 'text-danger' : 'text-warning'}`}>{r.skip ? `übersprungen: ${r.warning}` : r.warning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
