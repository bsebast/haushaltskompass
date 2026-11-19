import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { listPensions, savePension, deletePension } from '../db/repo';
import type { Pension } from '../db/types';
import { formatDate } from '../lib/dates';

const showDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : s ?? '–');

export default function Pensions() {
  const rows = useQuery(listPensions);
  const [edit, setEdit] = useState<Pension | 'new' | null>(null);
  const persons = [...new Set(rows.map((r) => r.person ?? ''))];
  return (
    <>
      <PageHeader title="Vorsorge" subtitle="Renten, Lebensversicherungen und Betriebsrenten mit erwarteter Leistung." actions={
        <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Eintrag</button>
      } />
      {rows.length === 0 ? <div className="card"><Empty title="Noch keine Vorsorge erfasst" /></div> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
            {persons.map((p) => {
              const r = rows.filter((x) => (x.person ?? '') === p);
              return (
                <div key={p} className="card p-4">
                  <div className="text-xs text-text-muted">{p || 'Ohne Person'}</div>
                  <div className="text-xl font-semibold mt-1"><Money cents={r.reduce((s, x) => s + (x.monthly_pension ?? 0), 0)} colored={false} /> <span className="text-sm font-normal text-text-muted">Rente/Monat</span></div>
                  <div className="text-sm text-text-muted"><Money cents={r.reduce((s, x) => s + (x.lump_sum ?? 0), 0)} colored={false} /> als Einmalbetrag</div>
                </div>
              );
            })}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-surface-2 text-xs text-text-muted">
                <tr><th className="text-left px-4 py-2 font-medium">Anbieter</th><th className="text-left px-2 font-medium">Person</th><th className="text-right px-2 font-medium">Beitrag</th>
                  <th className="text-right px-2 font-medium">Einmalbetrag</th><th className="text-right px-2 font-medium">Rente/Monat</th><th className="text-right px-2 font-medium">Hochrechnungen</th>
                  <th className="text-left px-2 font-medium">Beginn</th><th className="text-left px-2 font-medium">Stand</th><th className="w-10" /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><div className="font-medium">{r.provider}</div>
                      {(r.note || r.death_action) && <div className="text-xs text-text-muted">{[r.note, r.death_action ? `Todesfall: ${r.death_action}` : null, r.advisor ? `über ${r.advisor}` : null].filter(Boolean).join(' · ')}</div>}</td>
                    <td className="px-2">{r.person ?? '–'}</td>
                    <td className="px-2 text-right whitespace-nowrap">{r.contribution != null ? <><Money cents={r.contribution} colored={false} /> <span className="text-xs text-text-muted">{r.interval}</span></> : '–'}</td>
                    <td className="px-2 text-right">{r.lump_sum != null ? <Money cents={r.lump_sum} colored={false} /> : '–'}</td>
                    <td className="px-2 text-right">{r.monthly_pension != null ? <Money cents={r.monthly_pension} colored={false} /> : '–'}</td>
                    <td className="px-2 text-right text-xs text-text-muted whitespace-nowrap">{[r.projection1, r.projection2, r.projection3].filter((x) => x != null).map((x) => <Money key={x} cents={x!} colored={false} className="ml-2" />)}</td>
                    <td className="px-2 whitespace-nowrap">{showDate(r.start_text)}</td>
                    <td className="px-2 whitespace-nowrap text-text-muted">{showDate(r.as_of)}</td>
                    <td className="px-2"><button className="btn-ghost w-8 h-8 px-0" aria-label={`${r.provider} bearbeiten`} onClick={() => setEdit(r)}><Pencil size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-muted mt-3">Die Beiträge stehen zusätzlich als Verträge unter „Verträge“ und zählen dort zu den Fixkosten.</p>
        </>
      )}
      {edit && <PensionDialog pension={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PensionDialog({ pension: p, onClose }: { pension: Pension | null; onClose: () => void }) {
  const book = useBook();
  const [f, setF] = useState<Omit<Pension, 'id'>>(p ?? {
    person: '', provider: '', contribution: null, interval: 'monatlich', lump_sum: null, monthly_pension: null, projection1: null, projection2: null,
    projection3: null, start_text: '', as_of: '', advisor: '', death_action: '', note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    try { savePension(book, { ...f, id: p?.id }); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={p ? 'Vorsorge bearbeiten' : 'Neue Vorsorge'} onClose={onClose} wide footer={
      <>
        {p && <button className="btn-ghost text-danger mr-auto" onClick={() => { deletePension(book, p.id); onClose(); }}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button><button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Anbieter"><input className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)} /></Field>
          <Field label="Person"><input className="input" value={f.person ?? ''} onChange={(e) => set('person', e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Beitrag"><AmountInput value={f.contribution} onChange={(v) => set('contribution', v)} /></Field>
          <Field label="Rhythmus"><input className="input" value={f.interval ?? ''} onChange={(e) => set('interval', e.target.value)} /></Field>
          <Field label="Einmalbetrag"><AmountInput value={f.lump_sum} onChange={(v) => set('lump_sum', v)} /></Field>
          <Field label="Rente monatlich"><AmountInput value={f.monthly_pension} onChange={(v) => set('monthly_pension', v)} /></Field>
          <Field label="Beginn"><input className="input" value={f.start_text ?? ''} onChange={(e) => set('start_text', e.target.value)} placeholder="JJJJ-MM-TT oder Text" /></Field>
          <Field label="Stand"><input className="input" value={f.as_of ?? ''} onChange={(e) => set('as_of', e.target.value)} placeholder="JJJJ-MM-TT" /></Field>
          <Field label="Hochrechnung 1"><AmountInput value={f.projection1} onChange={(v) => set('projection1', v)} /></Field>
          <Field label="Hochrechnung 2"><AmountInput value={f.projection2} onChange={(v) => set('projection2', v)} /></Field>
          <Field label="Hochrechnung 3"><AmountInput value={f.projection3} onChange={(v) => set('projection3', v)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Über Berater"><input className="input" value={f.advisor ?? ''} onChange={(e) => set('advisor', e.target.value)} /></Field>
          <Field label="Aktion im Todesfall"><input className="input" value={f.death_action ?? ''} onChange={(e) => set('death_action', e.target.value)} /></Field>
        </div>
        <Field label="Bemerkung"><input className="input" value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} /></Field>
        <button type="submit" hidden /><ErrorNote error={error} />
      </form>
    </Modal>
  );
}
