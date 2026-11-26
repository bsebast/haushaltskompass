import { useMemo, useState } from 'react';
import { Plus, Upload, Pencil, FileX, Check, X, TrendingUp, TrendingDown } from 'lucide-react';
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
import { formatCents } from '../lib/money';
import {
  detectContracts, acceptSuggestion, dismissSuggestion, priceChanges, updateContractAmount, cancellation, upcomingDeadlines,
  insuranceCheck, loadSender, saveSender, cancellationLetter, markCancelled, type LetterMode, type Sender,
} from '../db/contractCheck';

export default function Contracts() {
  const [showEnded, setShowEnded] = useState(false);
  const all = useQuery((b) => listContracts(b, showEnded), [showEnded]);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [deathOnly, setDeathOnly] = useState(false);
  const [edit, setEdit] = useState<Contract | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [letter, setLetter] = useState<Contract | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const suggestions = useQuery((b) => detectContracts(b));
  const changes = useQuery((b) => priceChanges(b));
  const deadlines = useQuery((b) => upcomingDeadlines(b, 60));
  const insurance = useQuery(insuranceCheck);
  const book = useBook();

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

          {suggestions.length > 0 && (
            <section className="card p-5 mb-4" aria-label="Erkannte Verträge">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold">{suggestions.length} regelmäßige Abbuchungen ohne Vertrag erkannt</h2>
                <span className="text-xs text-text-muted">zusammen {formatCents(suggestions.reduce((a, s) => a + perYear(s), 0))} im Jahr</span>
              </div>
              <ul className="divide-y divide-border text-sm">
                {(showAllSuggestions ? suggestions : suggestions.slice(0, 6)).map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className="flex-1 min-w-[12rem]">
                      <div className="font-medium truncate">{s.payee}</div>
                      <div className="text-xs text-text-muted">{INTERVALS[s.interval]} · {s.count} Zahlungen, zuletzt am {formatDate(s.lastDate)} · {s.account_name}{s.category_name ? ` · ${s.category_name}` : ''}</div>
                    </div>
                    <Money cents={s.amount} />
                    <div className="flex gap-1">
                      <button className="btn-secondary py-1" onClick={() => acceptSuggestion(book, s)}><Check size={14} />Als Vertrag</button>
                      <button className="btn-ghost py-1" onClick={() => dismissSuggestion(book, s)} aria-label={`${s.payee} ist kein Vertrag`} title="Kein Vertrag, nicht mehr vorschlagen"><X size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
              {suggestions.length > 6 && <button className="text-sm text-accent hover:underline mt-2" onClick={() => setShowAllSuggestions(!showAllSuggestions)}>{showAllSuggestions ? 'Weniger zeigen' : `Alle ${suggestions.length} zeigen`}</button>}
            </section>
          )}

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
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((c) => {
                      const nd = c.status === 'confirmed' ? nextDue(c) : null;
                      const cx = c.status === 'confirmed' && !c.end_date ? cancellation(c) : null;
                      return (
                        <tr key={c.id} className={c.status === 'ended' ? 'opacity-50' : ''}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-text-muted">{[c.purpose, c.kind, c.payment_method].filter(Boolean).join(' · ')}</div>
                            {c.note && <div className="text-xs text-warning">{c.note}</div>}
                            {c.end_date && c.status === 'confirmed' && <div className="text-xs text-text-muted">endet am {formatDate(c.end_date)}</div>}
                            {cx?.deadline && <div className={`text-xs ${cx.daysLeft! <= 60 ? 'text-warning font-medium' : 'text-text-muted'}`}>kündbar bis {formatDate(cx.deadline)} zum {formatDate(cx.termEnd!)}</div>}
                            {cx?.anytime && <div className="text-xs text-text-muted">jederzeit kündbar</div>}
                            {(c.death_action || c.notice_period || c.doc_ref) && <div className="text-xs text-text-muted">{[c.notice_period ? `Kündigungsfrist ${c.notice_period}` : null, c.death_action ? `Todesfall: ${c.death_action}` : null, c.doc_ref ? `Ablage ${c.doc_ref}` : null, c.advisor ? `über ${c.advisor}` : null].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{c.person ?? '–'}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{c.category_name ? <span className="inline-flex items-center gap-1.5"><Dot color={c.category_color} />{c.category_name}</span> : <span className="text-text-muted">–</span>}</td>
                          <td className="px-2 py-2 text-right"><Money cents={c.amount} /></td>
                          <td className="px-2 py-2 whitespace-nowrap">{INTERVALS[c.interval]}</td>
                          <td className="px-2 py-2 whitespace-nowrap tabular-nums">{c.status === 'ended' ? 'beendet' : nd ? formatDate(nd) : '–'}</td>
                          <td className="px-2 py-2 text-right text-text-muted"><Money cents={perMonth(c)} colored={false} /></td>
                          <td className="px-2 whitespace-nowrap">
                            <button className="btn-ghost w-8 h-8 px-0" aria-label={`${c.name} bearbeiten`} title="Bearbeiten" onClick={() => setEdit(c)}><Pencil size={15} /></button>
                            {c.status === 'confirmed' && <button className="btn-ghost w-8 h-8 px-0" aria-label={`${c.name} kündigen`} title="Kündigungsschreiben" onClick={() => setLetter(c)}><FileX size={15} /></button>}
                          </td>
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
              {deadlines.length > 0 && (
                <section className="card p-5 border-warning/50">
                  <h2 className="text-sm font-semibold mb-3">Kündigungsfristen in den nächsten 60 Tagen</h2>
                  <ul className="space-y-2 text-sm">
                    {deadlines.map((d) => (
                      <li key={d.contract.id} className="flex gap-2 items-baseline">
                        <span className="tabular-nums text-warning w-20 shrink-0">{formatDate(d.deadline!)}</span>
                        <span className="flex-1 truncate">{d.contract.name}{d.contract.purpose ? ` · ${d.contract.purpose}` : ''}</span>
                        <button className="text-xs text-accent hover:underline" onClick={() => setLetter(d.contract)}>kündigen</button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-muted mt-2">Spätester Eingang beim Anbieter, sonst verlängert sich der Vertrag.</p>
                </section>
              )}
              {changes.length > 0 && (
                <section className="card p-5">
                  <h2 className="text-sm font-semibold mb-3">Preisänderungen (letzte 6 Monate)</h2>
                  <ul className="space-y-3 text-sm">
                    {changes.map((x) => (
                      <li key={x.contract.id}>
                        <div className="flex gap-2 items-center">
                          {x.perYear < 0 ? <TrendingUp size={14} className="text-danger shrink-0" aria-label="teurer" /> : <TrendingDown size={14} className="text-success shrink-0" aria-label="günstiger" />}
                          <span className="flex-1 truncate font-medium">{x.contract.name}{x.contract.purpose ? ` · ${x.contract.purpose}` : ''}</span>
                        </div>
                        <div className="text-xs text-text-muted ml-5">
                          {formatCents(x.previous)} → {formatCents(x.current)} am {formatDate(x.date)} · {x.perYear < 0 ? 'teurer' : 'günstiger'} um {formatCents(Math.abs(x.perYear))} im Jahr
                        </div>
                        <div className="ml-5 flex gap-3 text-xs mt-0.5">
                          {x.contractOutdated && <button className="text-accent hover:underline" onClick={() => updateContractAmount(book, x.contract.id, x.current)}>Betrag im Vertrag anpassen</button>}
                          {x.perYear < 0 && <button className="text-accent hover:underline" onClick={() => setLetter(x.contract)}>Sonderkündigung</button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
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
              <InsuranceCard rows={insurance} />
            </aside>
          </div>
        </>
      )}
      {edit && <ContractDialog contract={edit === 'new' ? null : edit} onClose={() => setEdit(null)} kinds={kinds} persons={persons} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {letter && <LetterDialog contract={letter} onClose={() => setLetter(null)} />}
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
  const [start, setStart] = useState(c?.start_date ?? '');
  const [term, setTerm] = useState(c?.term_months ? String(c.term_months) : '');
  const [end, setEnd] = useState(c?.end_date ?? '');
  const [customerNo, setCustomerNo] = useState(c?.customer_no ?? '');
  const [address, setAddress] = useState(c?.address ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      if (!amount) throw new Error('Bitte einen Betrag eingeben.');
      const d = parseDue(due);
      saveContract(book, {
        id: c?.id, name, person: person || null, purpose: purpose || null, kind: kind || null, amount: (income ? 1 : -1) * amount, interval,
        due_day: d.day, due_months: d.months, category_id: category, account_id: account || null, payment_method: payment || null,
        note: note || null, notice_period: notice || null, doc_ref: docRef || null, advisor: advisor || null, death_action: deathAction || null,
        start_date: start || null, term_months: term ? Number(term) : null, customer_no: customerNo || null, address: address || null,
        status: ended ? 'ended' : 'confirmed', end_date: end || (ended ? new Date().toISOString().slice(0, 10) : null),
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
          <Field label="Kündigungsfrist" hint="z. B. 3 Monate, 1 Monat zum Monatsende, 14 Tage, sofort"><input className="input" value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="z. B. 3 Monate" /></Field>
          <Field label="Laufzeit / Verlängerung" hint="leer = wie der Rhythmus">
            <select className="input" value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">wie Rhythmus</option>
              {[1, 3, 6, 12, 24, 36].map((m) => <option key={m} value={m}>{m === 1 ? '1 Monat' : `${m} Monate`}</option>)}
            </select>
          </Field>
          <Field label="Vertragsbeginn" hint="für die Berechnung der Kündigungsfrist"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Vertragsende" hint="gekündigt oder befristet zum"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Kunden- / Vertragsnummer"><input className="input" value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} /></Field>
          <Field label="Anschrift des Anbieters" hint="für das Kündigungsschreiben"><textarea className="input min-h-[4.5rem]" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={'Firma\nStraße Nr.\nPLZ Ort'} /></Field>
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

function InsuranceCard({ rows }: { rows: ReturnType<typeof insuranceCheck> }) {
  const [open, setOpen] = useState(false);
  const found = rows.filter((r) => r.contracts.length).length;
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">Versicherungs-Check</h2>
        <span className="text-xs text-text-muted">{found} von {rows.length} Arten vorhanden</span>
      </div>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.type.id}>
            <div className="flex items-center gap-2">
              {r.contracts.length ? <Check size={14} className="text-success shrink-0" aria-label="vorhanden" /> : <span className="w-3.5 h-3.5 rounded-full border border-border-input shrink-0" aria-label="nicht gefunden" />}
              <span className={`flex-1 ${r.contracts.length ? '' : 'text-text-muted'}`}>{r.type.label}</span>
              {r.contracts.length > 0 && <span className="text-xs text-text-muted"><Money cents={r.perYear} colored={false} /> /Jahr</span>}
            </div>
            {r.contracts.length > 0 && (
              <div className="text-xs text-text-muted ml-5 truncate">{r.contracts.map((c) => `${c.name}${c.person ? ` (${c.person})` : ''}`).join(', ')}</div>
            )}
            {open && !r.contracts.length && <div className="text-xs text-text-muted ml-5">{r.type.hint}</div>}
          </li>
        ))}
      </ul>
      <button className="text-xs text-accent hover:underline mt-3" onClick={() => setOpen(!open)}>{open ? 'Hinweise ausblenden' : 'Hinweise zu fehlenden Arten'}</button>
      <p className="text-xs text-text-muted mt-1">Erkannt an Name, Zweck, Art und Kategorie der Verträge. Keine Beratung, nur ein Überblick.</p>
    </section>
  );
}

function LetterDialog({ contract: c, onClose }: { contract: Contract; onClose: () => void }) {
  const book = useBook();
  const cx = cancellation(c);
  const [sender, setSender] = useState<Sender>(() => loadSender(book));
  const [recipient, setRecipient] = useState(c.address ?? c.name);
  const [customerNo, setCustomerNo] = useState(c.customer_no ?? '');
  const [mode, setMode] = useState<LetterMode>('regular');
  const [date, setDate] = useState(cx.termEnd ?? '');
  const [reason, setReason] = useState('Beitrags- bzw. Preiserhöhung');
  const [mark, setMark] = useState(true);
  const [copied, setCopied] = useState(false);
  const text = cancellationLetter({ sender, recipient, contractName: c.name, purpose: c.purpose, customerNo, mode, date, reason });

  const remember = () => {
    saveSender(book, sender);
    if (recipient.trim() !== (c.address ?? c.name) || customerNo !== (c.customer_no ?? '')) {
      book.run('update recurring set address = ?, customer_no = ? where id = ?', [recipient.trim() || null, customerNo.trim() || null, c.id]);
    }
    if (mark) markCancelled(book, c, mode === 'special' ? null : (mode === 'date' ? date : cx.termEnd) || null);
  };
  const print = () => {
    remember();
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kündigung ${esc(c.name)}</title>
      <style>body{font:12pt/1.5 Georgia,serif;margin:25mm 20mm;white-space:pre-wrap;color:#000;background:#fff}</style></head><body>${esc(text)}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); remember(); } catch { setCopied(false); }
  };
  const setS = (k: keyof Sender) => (e: React.ChangeEvent<HTMLInputElement>) => setSender({ ...sender, [k]: e.target.value });

  return (
    <Modal title={`Kündigung: ${c.name}`} onClose={onClose} wide footer={
      <>
        <button className="btn-secondary" onClick={onClose}>Schließen</button>
        <button className="btn-secondary" onClick={copy}>{copied ? 'Kopiert' : 'Text kopieren'}</button>
        <button className="btn-primary" onClick={print}>Drucken / PDF</button>
      </>
    }>
      <div className="grid gap-3 text-sm">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Dein Name"><input className="input" value={sender.name} onChange={setS('name')} /></Field>
          <Field label="Straße"><input className="input" value={sender.street} onChange={setS('street')} /></Field>
          <Field label="PLZ Ort"><input className="input" value={sender.city} onChange={setS('city')} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="An (Anschrift des Anbieters)"><textarea className="input min-h-[5rem]" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
          <div className="grid gap-3 content-start">
            <Field label="Kunden- / Vertragsnummer"><input className="input" value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} /></Field>
            <Field label="Art der Kündigung">
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as LetterMode)}>
                <option value="regular">fristgerecht zum nächstmöglichen Termin</option>
                <option value="date">fristgerecht zu einem Datum</option>
                <option value="special">außerordentlich (Sonderkündigung)</option>
              </select>
            </Field>
          </div>
        </div>
        {mode === 'date' && <Field label="Kündigen zum"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {mode === 'special' && <Field label="Grund"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        {cx.deadline && <p className="text-xs text-text-muted">Laut Vertragsdaten: Kündigung muss bis {formatDate(cx.deadline)} eingehen, Vertragsende dann {formatDate(cx.termEnd!)}.</p>}
        {cx.missing && <p className="text-xs text-text-muted">Termin nicht berechenbar ({cx.missing}). Trage Vertragsbeginn und Kündigungsfrist im Vertrag ein, dann erinnert die App rechtzeitig.</p>}
        <pre className="whitespace-pre-wrap font-serif text-sm bg-surface-2 border border-border rounded-md p-4 max-h-72 overflow-auto">{text}</pre>
        <label className="flex items-center gap-2"><input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Beim Drucken oder Kopieren im Vertrag als gekündigt vermerken</label>
        <p className="text-xs text-text-muted">Am sichersten per Einschreiben oder über das Kündigungsformular des Anbieters senden. Die Anschrift und deine Absenderdaten werden für das nächste Mal gespeichert.</p>
      </div>
    </Modal>
  );
}
