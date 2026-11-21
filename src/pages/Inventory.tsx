import { useMemo, useState } from 'react';
import { Plus, Paperclip, Download } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import {
  listInventory, saveInventory, deleteInventory, addDocument, getDocument, removeDocumentIfUnused, valueOf, inventoryTotals, warrantyEndingSoon,
  inventoryInWealth, setInventoryInWealth, inventoryCsv, MAX_DOC, type InventoryItem,
} from '../db/inventory';
import { formatDate, today } from '../lib/dates';
import { download } from '../lib/csvExport';

type Group = 'room' | 'category' | 'owner';
const GROUP_LABEL: Record<Group, string> = { room: 'Raum', category: 'Kategorie', owner: 'Person' };

export function openDocument(b: ReturnType<typeof useBook>, id: string) {
  const d = getDocument(b, id);
  if (!d) return;
  const url = URL.createObjectURL(new Blob([d.data as BlobPart], { type: d.mime }));
  const w = window.open(url, '_blank');
  if (!w) download(d.filename, d.data as BlobPart, d.mime);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function Inventory() {
  const book = useBook();
  const items = useQuery(listInventory);
  const inWealth = useQuery(inventoryInWealth);
  const [edit, setEdit] = useState<InventoryItem | 'new' | null>(null);
  const [group, setGroup] = useState<Group>('room');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((x) => [x.name, x.category, x.room, x.owner, x.serial, x.note, x.insurance].some((v) => v?.toLowerCase().includes(t))) : items;
  }, [items, q]);
  const groups = useMemo(() => {
    const m = new Map<string, InventoryItem[]>();
    for (const x of shown) { const k = x[group] ?? ''; m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.entries()].sort((a, b) => (a[0] || '￿').localeCompare(b[0] || '￿', 'de'));
  }, [shown, group]);
  const total = inventoryTotals(shown);
  const soon = items.filter((x) => warrantyEndingSoon(x));

  return (
    <>
      <PageHeader title="Inventar" subtitle="Wertgegenstände mit Kaufpreis, Zeitwert und Beleg, griffbereit für die Hausratversicherung."
        actions={<>
          {items.length > 0 && <button className="btn-secondary" onClick={() => download(`inventar-${today()}.csv`, '﻿' + inventoryCsv(shown), 'text/csv;charset=utf-8')}><Download size={14} /> CSV</button>}
          {items.length > 0 && <button className="btn-secondary" onClick={() => window.print()}>Drucken</button>}
          <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={14} /> Gegenstand</button>
        </>} />
      {items.length === 0 ? (
        <div className="card"><Empty title="Noch kein Inventar" text="Erfasse Möbel, Technik, Schmuck oder Fahrräder mit Kaufpreis und Rechnung. Im Schadensfall hast du alles beisammen."
          action={<button className="btn-primary" onClick={() => setEdit('new')}>Ersten Gegenstand erfassen</button>} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="card p-5"><div className="text-xs text-text-muted">Gegenstände</div><div className="text-xl font-semibold mt-1">{shown.length}</div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Kaufpreis gesamt</div><div className="text-xl font-semibold mt-1"><Money cents={total.price} colored={false} /></div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Zeitwert gesamt</div><div className="text-xl font-semibold mt-1"><Money cents={total.value} colored={false} /></div></div>
            <div className="card p-5"><div className="text-xs text-text-muted">Garantie endet bald</div><div className="text-xl font-semibold mt-1">{soon.length}</div>
              <div className="text-xs text-text-muted mt-0.5">in den nächsten 60 Tagen</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3 no-print">
            <input className="input w-64" placeholder="Suche" aria-label="Suche" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="inline-flex rounded-md bg-surface-2 p-1">
              {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
                <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)} className={`px-3 h-7 rounded text-sm ${group === g ? 'bg-surface shadow-card font-medium' : 'text-text-muted'}`}>nach {GROUP_LABEL[g]}</button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm ml-auto">
              <input type="checkbox" checked={inWealth} onChange={(e) => setInventoryInWealth(book, e.target.checked)} /> Zeitwert zum Vermögen zählen
            </label>
          </div>
          <section className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-surface-2 text-xs text-text-muted">
                <tr><th className="text-left px-4 py-2 font-medium">Gegenstand</th><th className="text-left px-2 font-medium">{group === 'room' ? 'Kategorie' : 'Raum'}</th>
                  <th className="text-left px-2 font-medium">Gekauft</th><th className="text-right px-2 font-medium">Kaufpreis</th><th className="text-right px-2 font-medium">Zeitwert</th>
                  <th className="text-left px-2 font-medium">Garantie bis</th><th className="px-4 font-medium">Beleg</th></tr>
              </thead>
              {groups.map(([k, xs]) => {
                const t = inventoryTotals(xs);
                return (
                  <tbody key={k} className="divide-y divide-border">
                    <tr className="bg-surface-2/60"><td colSpan={3} className="px-4 py-1.5 font-semibold">{k || `Ohne ${GROUP_LABEL[group]}`}</td>
                      <td className="text-right px-2 font-semibold"><Money cents={t.price} colored={false} /></td><td className="text-right px-2 font-semibold"><Money cents={t.value} colored={false} /></td><td colSpan={2} /></tr>
                    {xs.map((x) => (
                      <tr key={x.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => setEdit(x)}>
                        <td className="px-4 py-1.5"><div className="font-medium">{x.name}</div>{(x.serial || x.owner) && <div className="text-xs text-text-muted">{[x.owner, x.serial && `Nr. ${x.serial}`].filter(Boolean).join(' · ')}</div>}</td>
                        <td className="px-2 text-text-muted">{group === 'room' ? x.category : x.room}</td>
                        <td className="px-2 tabular-nums">{x.purchase_date ? formatDate(x.purchase_date) : '–'}</td>
                        <td className="text-right px-2">{x.purchase_price != null ? <Money cents={x.purchase_price} colored={false} /> : '–'}</td>
                        <td className="text-right px-2"><Money cents={valueOf(x)} colored={false} />{x.current_value == null && x.useful_life ? <div className="text-xs text-text-muted">{x.useful_life} J. linear</div> : null}</td>
                        <td className={`px-2 tabular-nums ${warrantyEndingSoon(x) ? 'text-warning font-medium' : x.warranty_until && x.warranty_until < today() ? 'text-text-muted line-through' : ''}`}>{x.warranty_until ? formatDate(x.warranty_until) : '–'}</td>
                        <td className="px-4 text-center">{x.document_id ? <button className="text-accent hover:underline inline-flex items-center gap-1" onClick={(e) => { e.stopPropagation(); openDocument(book, x.document_id!); }} title={x.doc_name ?? ''}><Paperclip size={14} /> öffnen</button> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </section>
        </>
      )}
      {edit && <ItemDialog item={edit === 'new' ? null : edit} items={items} onClose={() => setEdit(null)} />}
    </>
  );
}

function ItemDialog({ item, items, onClose }: { item: InventoryItem | null; items: InventoryItem[]; onClose: () => void }) {
  const book = useBook();
  const [f, setF] = useState({
    name: item?.name ?? '', category: item?.category ?? '', room: item?.room ?? '', owner: item?.owner ?? '', purchase_date: item?.purchase_date ?? '',
    serial: item?.serial ?? '', warranty_until: item?.warranty_until ?? '', insurance: item?.insurance ?? '', note: item?.note ?? '',
    useful_life: item?.useful_life != null ? String(item.useful_life) : '',
  });
  const [price, setPrice] = useState<number | null>(item?.purchase_price ?? null);
  const [value, setValue] = useState<number | null>(item?.current_value ?? null);
  const [doc, setDoc] = useState<{ id: string | null; name: string | null; file?: File }>({ id: item?.document_id ?? null, name: item?.doc_name ?? null });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const opts = (k: 'category' | 'room' | 'owner') => [...new Set(items.map((x) => x[k]).filter(Boolean))] as string[];

  const save = async () => {
    try {
      const life = f.useful_life.trim() ? Number(f.useful_life) : null;
      let documentId = doc.id;
      let bytes: Uint8Array | null = null;
      if (doc.file) {
        if (doc.file.size > MAX_DOC) throw new Error('Der Beleg ist größer als 20 MB.');
        bytes = new Uint8Array(await doc.file.arrayBuffer());
      }
      book.tx(() => {
        if (doc.file && bytes) documentId = addDocument(book, doc.file.name, doc.file.type, bytes);
        saveInventory(book, { id: item?.id, ...f, useful_life: life, purchase_price: price, current_value: value, document_id: documentId });
        if (item?.document_id && item.document_id !== documentId) removeDocumentIfUnused(book, item.document_id);
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = () => {
    if (item && window.confirm(`„${item.name}“ aus dem Inventar löschen?`)) { deleteInventory(book, item.id); onClose(); }
  };
  const preview = valueOf({ current_value: null, purchase_price: price, purchase_date: f.purchase_date || null, useful_life: Number(f.useful_life) || null });

  return (
    <Modal title={item ? 'Gegenstand bearbeiten' : 'Gegenstand erfassen'} onClose={onClose} wide footer={<>
      {item && <button className="btn-ghost text-danger mr-auto" onClick={remove}>Löschen</button>}
      <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
      <button className="btn-primary" onClick={() => void save()}>Speichern</button>
    </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Gegenstand"><input className="input" value={f.name} onChange={set('name')} placeholder="z. B. Fernseher Wohnzimmer" /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Kategorie"><input className="input" list="inv-cat" value={f.category} onChange={set('category')} placeholder="z. B. Elektronik" /></Field>
          <Field label="Raum"><input className="input" list="inv-room" value={f.room} onChange={set('room')} placeholder="z. B. Wohnzimmer" /></Field>
          <Field label="Person"><input className="input" list="inv-owner" value={f.owner} onChange={set('owner')} /></Field>
        </div>
        <datalist id="inv-cat">{[...new Set([...opts('category'), 'Elektronik', 'Möbel', 'Haushaltsgeräte', 'Schmuck & Uhren', 'Fahrrad', 'Kleidung', 'Werkzeug', 'Sport & Freizeit', 'Kunst & Sammlung'])].map((o) => <option key={o} value={o} />)}</datalist>
        <datalist id="inv-room">{[...new Set([...opts('room'), 'Wohnzimmer', 'Küche', 'Schlafzimmer', 'Kinderzimmer', 'Bad', 'Arbeitszimmer', 'Keller', 'Garage', 'Garten'])].map((o) => <option key={o} value={o} />)}</datalist>
        <datalist id="inv-owner">{opts('owner').map((o) => <option key={o} value={o} />)}</datalist>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Kaufdatum"><input type="date" className="input" value={f.purchase_date} onChange={set('purchase_date')} /></Field>
          <Field label="Kaufpreis"><AmountInput value={price} onChange={setPrice} ariaLabel="Kaufpreis" /></Field>
          <Field label="Nutzungsdauer (Jahre)" hint="für den Zeitwert, optional"><input className="input" inputMode="numeric" value={f.useful_life} onChange={set('useful_life')} /></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Zeitwert (optional)" hint={value == null ? `berechnet: ${(preview / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : 'von Hand gesetzt'}>
            <AmountInput value={value} onChange={setValue} ariaLabel="Zeitwert" /></Field>
          <Field label="Garantie bis"><input type="date" className="input" value={f.warranty_until} onChange={set('warranty_until')} /></Field>
          <Field label="Seriennummer"><input className="input" value={f.serial} onChange={set('serial')} /></Field>
        </div>
        <Field label="Versicherung"><input className="input" value={f.insurance} onChange={set('insurance')} placeholder="z. B. Hausrat, Elektronikversicherung" /></Field>
        <Field label="Bemerkung"><input className="input" value={f.note} onChange={set('note')} /></Field>
        <div>
          <span className="label">Beleg (Rechnung, Foto, PDF)</span>
          <div className="flex flex-wrap items-center gap-2">
            {doc.name && <span className="text-sm inline-flex items-center gap-1"><Paperclip size={14} />{doc.name}</span>}
            {doc.id && !doc.file && <button type="button" className="text-sm text-accent hover:underline" onClick={() => openDocument(book, doc.id!)}>öffnen</button>}
            {doc.name && <button type="button" className="text-sm text-danger hover:underline" onClick={() => setDoc({ id: null, name: null })}>entfernen</button>}
            <label className="btn-secondary h-8 cursor-pointer">{doc.name ? 'Ersetzen' : 'Datei wählen'}
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) setDoc({ id: null, name: file.name, file }); }} /></label>
          </div>
          <p className="text-xs text-text-muted mt-1">Der Beleg wird im Haushaltsbuch gespeichert und ist in der Sicherung enthalten (bis 20 MB).</p>
        </div>
      </form>
      <ErrorNote error={error} />
    </Modal>
  );
}
