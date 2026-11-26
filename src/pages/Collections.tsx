import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, ListOrdered } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty, Dot } from '../components/ui';
import { listCollections, saveCollection, deleteCollection, collectionByCategory, type Collection } from '../db/collections';
import { goalColor } from '../db/goals';
import { formatDate } from '../lib/dates';

export default function Collections() {
  const all = useQuery((b) => listCollections(b));
  const [edit, setEdit] = useState<Collection | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const active = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);

  return (
    <>
      <PageHeader title="Sammlungen" subtitle="Buchungen quer zu den Kategorien bündeln, z. B. eine Reise, ein Umbau oder ein Fest, und sehen, was es insgesamt gekostet hat."
        actions={<button className="btn-primary" onClick={() => setEdit('new')}><Plus size={14} /> Sammlung</button>} />
      {all.length === 0 ? (
        <div className="card"><Empty title="Noch keine Sammlungen"
          text="Lege eine Sammlung an, z. B. „Sommerurlaub 2026“. Danach markierst du unter Buchungen die passenden Buchungen und wählst „Zu Sammlung hinzufügen“."
          action={<button className="btn-primary" onClick={() => setEdit('new')}>Erste Sammlung anlegen</button>} /></div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((c, i) => <CollectionCard key={c.id} c={c} index={i} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onEdit={() => setEdit(c)} />)}
          </div>
          {archived.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-text-muted mb-2">Archiviert</h2>
              <ul className="card divide-y divide-border">
                {archived.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <button className="flex-1 text-left truncate hover:underline" onClick={() => setEdit(c)}>{c.name}</button>
                    <span className="text-text-muted">{c.count} Buchungen</span>
                    <Money cents={c.expense + c.income} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {edit && <CollectionDialog c={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CollectionCard({ c, index, open, onToggle, onEdit }: { c: Collection; index: number; open: boolean; onToggle: () => void; onEdit: () => void }) {
  const cats = useQuery((b) => (open ? collectionByCategory(b, c.id) : []), [open, c.id, c.count]);
  return (
    <section className="card p-5 border-t-4" style={{ borderTopColor: goalColor(c, index) }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{c.name}</h2>
          <p className="text-xs text-text-muted">
            {c.count} {c.count === 1 ? 'Buchung' : 'Buchungen'}
            {c.first && ` · ${formatDate(c.first)}${c.last && c.last !== c.first ? ` bis ${formatDate(c.last)}` : ''}`}
          </p>
          {c.note && <p className="text-xs text-text-muted mt-1">{c.note}</p>}
        </div>
        <button className="btn-ghost w-8 h-8 px-0 shrink-0" aria-label={`${c.name} bearbeiten`} onClick={onEdit}><Pencil size={15} /></button>
      </div>
      <div className="text-2xl font-semibold mt-3"><Money cents={c.expense + c.income} /></div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-text-muted">Ausgaben</dt><dd><Money cents={c.expense} /></dd></div>
        <div><dt className="text-xs text-text-muted">Einnahmen / Erstattungen</dt><dd><Money cents={c.income} /></dd></div>
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        <Link className="btn-secondary" to={`/buchungen?sammlung=${c.id}`}><ListOrdered size={14} /> Buchungen</Link>
        {c.count > 0 && <button className="btn-ghost" onClick={onToggle} aria-expanded={open}>{open ? 'Kategorien ausblenden' : 'Nach Kategorie'}</button>}
      </div>
      {open && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {cats.map((x) => (
            <li key={x.category_id ?? 'none'} className="flex items-center gap-2">
              <Dot color={x.color} /><span className="flex-1 truncate">{x.name}</span><Money cents={x.amount} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CollectionDialog({ c, onClose }: { c: Collection | null; onClose: () => void }) {
  const book = useBook();
  const [name, setName] = useState(c?.name ?? '');
  const [note, setNote] = useState(c?.note ?? '');
  const [archived, setArchived] = useState(!!c?.archived);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    try { saveCollection(book, { id: c?.id, name, note, archived }); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={c ? 'Sammlung bearbeiten' : 'Neue Sammlung'} onClose={onClose} footer={
      <>
        {c && <button className="btn-ghost text-danger mr-auto" onClick={() => { deleteCollection(book, c.id); onClose(); }}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <div className="grid gap-3">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sommerurlaub 2026" maxLength={80} /></Field>
        <Field label="Notiz"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {c && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivieren (abgeschlossen)</label>}
        {c && <p className="text-xs text-text-muted">Löschen entfernt nur die Sammlung, die Buchungen bleiben erhalten.</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
