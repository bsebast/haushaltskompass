import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Modal, Field, ErrorNote, Dot } from '../components/ui';
import CategorySelect from '../components/CategorySelect';
import { listCategories, categoryTree, saveCategory, deleteCategory, categoryUsage } from '../db/repo';
import type { CategoryNode, Category } from '../db/types';

export default function Categories() {
  const cats = useQuery(listCategories);
  const tree = categoryTree(cats);
  const [edit, setEdit] = useState<{ cat?: Category; kind: 'income' | 'expense'; parent?: string | null } | null>(null);

  const renderNode = (n: CategoryNode, depth: number): React.ReactNode => (
    <li key={n.id}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-2 group" style={{ paddingLeft: 8 + depth * 20 }}>
        <Dot color={n.color} />
        <span className={depth === 0 ? 'font-medium' : ''}>{n.name}</span>
        {n.tax_category && <span className="text-xs text-text-muted border border-border rounded px-1">Steuer: {n.tax_category}</span>}
        <div className="ml-auto flex gap-1 opacity-60 group-hover:opacity-100">
          {depth === 0 && <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setEdit({ kind: n.kind, parent: n.id })}><Plus size={14} />Unterkategorie</button>}
          <button className="btn-ghost h-7 w-7 px-0" aria-label={`${n.name} bearbeiten`} onClick={() => setEdit({ cat: n, kind: n.kind })}><Pencil size={14} /></button>
        </div>
      </div>
      {n.children.length > 0 && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <>
      <PageHeader title="Kategorien" subtitle="Ordne Buchungen in deine eigene Struktur ein." />
      <div className="grid gap-4 lg:grid-cols-2">
        {(['expense', 'income'] as const).map((k) => (
          <section key={k} className="card p-3">
            <div className="flex items-center justify-between px-2 mb-2">
              <h2 className="font-semibold">{k === 'expense' ? 'Ausgaben' : 'Einnahmen'}</h2>
              <button className="btn-secondary h-8" onClick={() => setEdit({ kind: k, parent: null })}><Plus size={14} />Kategorie</button>
            </div>
            <ul className="text-sm">{tree.filter((n) => n.kind === k).map((n) => renderNode(n, 0))}</ul>
          </section>
        ))}
      </div>
      {edit && <CategoryDialog {...edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CategoryDialog({ cat, kind, parent, onClose }: { cat?: Category; kind: 'income' | 'expense'; parent?: string | null; onClose: () => void }) {
  const book = useBook();
  const [name, setName] = useState(cat?.name ?? '');
  const [parentId, setParentId] = useState<string | null>(cat ? cat.parent_id : parent ?? null);
  const [color, setColor] = useState(cat?.color ?? '#0f6b63');
  const [tax, setTax] = useState(cat?.tax_category ?? '');
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usage = cat ? categoryUsage(book, cat.id) : 0;

  const save = () => {
    try {
      saveCategory(book, { id: cat?.id, name, kind, parent_id: parentId, color, tax_category: tax.trim() || null });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title={cat ? 'Kategorie bearbeiten' : 'Neue Kategorie'} onClose={onClose} footer={
      <>
        {cat && !confirmDel && <button className="btn-ghost text-danger mr-auto" onClick={() => setConfirmDel(true)}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        {confirmDel ? <button className="btn-danger" onClick={() => { deleteCategory(book, cat!.id, moveTo); onClose(); }}>Endgültig löschen</button>
          : <button className="btn-primary" onClick={save}>Speichern</button>}
      </>
    }>
      {confirmDel ? (
        <div className="space-y-3 text-sm">
          <p>„{cat!.name}“ wird gelöscht. Unterkategorien rücken eine Ebene nach oben.</p>
          {usage > 0 && (
            <Field label={`${usage} Buchungen verwenden diese Kategorie. Umhängen nach:`}>
              <CategorySelect value={moveTo} onChange={setMoveTo} kind={kind} emptyLabel="Ohne Kategorie lassen" />
            </Field>
          )}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Oberkategorie"><CategorySelect value={parentId} onChange={setParentId} kind={kind} emptyLabel="Keine (oberste Ebene)" /></Field>
          <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
            <Field label="Farbe"><input type="color" className="h-9 w-14 rounded border border-border-input" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
            <Field label="Steuerkategorie (optional)" hint="z. B. Werbungskosten, Sonderausgaben, Handwerkerleistungen">
              <input className="input" value={tax} onChange={(e) => setTax(e.target.value)} list="tax-cats" />
              <datalist id="tax-cats">
                {['Werbungskosten', 'Sonderausgaben', 'Außergewöhnliche Belastungen', 'Haushaltsnahe Dienstleistungen', 'Handwerkerleistungen', 'Vorsorgeaufwendungen', 'Spenden'].map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
          </div>
          <button type="submit" hidden />
          <ErrorNote error={error} />
        </form>
      )}
    </Modal>
  );
}
