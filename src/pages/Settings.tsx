import { useState } from 'react';
import { Download, Upload, Trash2 } from 'lucide-react';
import { useBook, useBookCtx } from '../state';
import { PageHeader, ErrorNote, Field } from '../components/ui';
import { download } from '../lib/csvExport';
import { listTransactions } from '../db/repo';
import { exportCsv } from '../lib/csvExport';

export default function Settings() {
  const book = useBook();
  const { load, reset } = useBookCtx();
  const [name, setName] = useState(book.meta('book_name') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const backup = () => {
    download(`haushaltskompass-${new Date().toISOString().slice(0, 10)}.hkb`, book.export() as BlobPart, 'application/octet-stream');
    book.setMeta('last_backup', new Date().toISOString());
    setInfo('Sicherung erstellt.');
  };

  const restore = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!window.confirm('Das aktuelle Haushaltsbuch wird durch die Sicherung ersetzt. Fortfahren?')) return;
    try {
      load(new Uint8Array(await f.arrayBuffer()));
      setInfo('Sicherung wiederhergestellt.');
    } catch (e) { setError((e as Error).message); }
  };

  const lastBackup = book.meta('last_backup');

  return (
    <>
      <PageHeader title="Einstellungen" />
      <div className="grid gap-4 max-w-2xl">
        <section className="card p-4 space-y-3">
          <h2 className="font-semibold">Haushaltsbuch</h2>
          <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { book.setMeta('book_name', name.trim()); setInfo('Name gespeichert.'); } }}>
            <div className="flex-1"><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <button className="btn-secondary" type="submit">Speichern</button>
          </form>
        </section>
        <section className="card p-4 space-y-3">
          <h2 className="font-semibold">Datensicherung</h2>
          <p className="text-sm text-text-muted">Deine Daten liegen nur in diesem Browser. Erstelle regelmäßig eine Sicherung, zum Beispiel auf einem USB-Stick oder in deinem Cloud-Ordner.
            {lastBackup ? ` Letzte Sicherung: ${new Date(lastBackup).toLocaleString('de-DE')}.` : ' Bisher wurde keine Sicherung erstellt.'}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={backup}><Download size={16} />Sicherung herunterladen</button>
            <label className="btn-secondary cursor-pointer"><Upload size={16} />Sicherung einspielen
              <input type="file" accept=".hkb,.sqlite,.db" className="sr-only" onChange={(e) => restore(e.target.files?.[0])} />
            </label>
            <button className="btn-secondary" onClick={() => exportCsv(listTransactions(book))}><Download size={16} />Alle Buchungen als CSV</button>
          </div>
        </section>
        <section className="card p-4 space-y-3 border-danger/40">
          <h2 className="font-semibold text-danger">Haushaltsbuch löschen</h2>
          <p className="text-sm text-text-muted">Entfernt alle Daten aus diesem Browser. Lade vorher eine Sicherung herunter.</p>
          <button className="btn-danger" onClick={() => { if (window.confirm('Wirklich alle Daten löschen? Das lässt sich nicht rückgängig machen.')) void reset(); }}><Trash2 size={16} />Alles löschen</button>
        </section>
        {info && <p className="text-sm text-success" role="status">{info}</p>}
        <ErrorNote error={error} />
      </div>
    </>
  );
}
