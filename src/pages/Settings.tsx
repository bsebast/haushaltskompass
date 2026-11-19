import { useState } from 'react';
import { Download, Upload, Trash2 } from 'lucide-react';
import { useBook, useBookCtx } from '../state';
import { PageHeader, ErrorNote, Field } from '../components/ui';
import { download } from '../lib/csvExport';
import { listTransactions } from '../db/repo';
import { exportCsv } from '../lib/csvExport';
import { parseImportFile, runImport, type ImportFile, type ImportSummary } from '../db/importer';

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
  const [pending, setPending] = useState<{ data: ImportFile; preview: ImportSummary; name: string } | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const readImport = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setResult(null);
    try {
      const data = parseImportFile(await f.text());
      setPending({ data, preview: runImport(book, data, { dryRun: true }), name: f.name });
    } catch (e) { setError((e as Error).message); }
  };

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
        <section className="card p-4 space-y-3">
          <h2 className="font-semibold">Daten importieren</h2>
          <p className="text-sm text-text-muted">Importiert eine Haushaltskompass-Importdatei (.json) mit Konten, Kontoständen, Buchungen, Depots, Verträgen und Vorsorge. Vorhandenes wird erkannt und nicht doppelt angelegt.</p>
          <label className="btn-secondary cursor-pointer w-fit"><Upload size={16} />Importdatei wählen
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void readImport(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {pending && (
            <div className="rounded-md border border-border p-3 text-sm space-y-2">
              <p className="font-medium">{pending.name}: Vorschau</p>
              <SummaryList s={pending.preview} />
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => { setResult(runImport(book, pending.data)); setPending(null); }}>Jetzt importieren</button>
                <button className="btn-ghost" onClick={() => setPending(null)}>Abbrechen</button>
              </div>
            </div>
          )}
          {result && <div className="rounded-md bg-accent-soft p-3 text-sm"><p className="font-medium mb-1">Import abgeschlossen</p><SummaryList s={result} /></div>}
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

function SummaryList({ s }: { s: ImportSummary }) {
  const items: [string, number][] = [
    ['neue Konten', s.accountsNew], ['bereits vorhandene Konten', s.accountsExisting], ['Kontostände', s.snapshots], ['Buchungen', s.transactions],
    ['Umbuchungen', s.transfers], ['Depotpositionen', s.holdings], ['neue Verträge', s.contractsNew], ['ergänzte Verträge', s.contractsMerged],
    ['übersprungene Verträge', s.contractsSkipped], ['Vorsorge-Einträge', s.pensions],
  ];
  return (
    <>
      <ul className="grid grid-cols-2 gap-x-4">{items.filter(([, n]) => n > 0).map(([l, n]) => <li key={l}><strong>{n}</strong> {l}</li>)}</ul>
      {s.warnings.length > 0 && <ul className="text-xs text-warning list-disc pl-4">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </>
  );
}
