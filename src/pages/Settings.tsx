import { useState } from 'react';
import { Download, Upload, Trash2, Sun, Moon, Monitor, Lock } from 'lucide-react';
import { clearLock, lockNow, setLock, setLockMinutes, useLockState, verifyPin } from '../lib/applock';
import { useTheme, type ThemePref } from '../lib/theme';
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
        <section className="card p-5 space-y-3">
          <h2 className="font-semibold">Haushaltsbuch</h2>
          <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { book.setMeta('book_name', name.trim()); setInfo('Name gespeichert.'); } }}>
            <div className="flex-1"><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <button className="btn-secondary" type="submit">Speichern</button>
          </form>
        </section>
        <AppearanceCard />
        <LockCard />
        <section className="card p-5 space-y-3">
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
        <section className="card p-5 space-y-3">
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
        <section className="card p-5 space-y-3 border-danger/40">
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

const THEMES: [ThemePref, string, typeof Sun][] = [['system', 'Wie System', Monitor], ['light', 'Hell', Sun], ['dark', 'Dunkel', Moon]];

function AppearanceCard() {
  const { pref, setPref } = useTheme();
  return (
    <section className="card p-5 space-y-3">
      <h2 className="font-semibold">Darstellung</h2>
      <p className="text-sm text-text-muted">Der Knopf oben rechts schaltet direkt zwischen hell und dunkel um. Mit „Wie System“ folgt die App wieder der Einstellung von Windows.</p>
      <div className="inline-flex rounded-lg bg-surface-2 p-1 gap-1" role="radiogroup" aria-label="Farbschema">
        {THEMES.map(([k, l, Icon]) => (
          <button key={k} type="button" role="radio" aria-checked={pref === k} onClick={() => setPref(k)}
            className={`inline-flex items-center gap-2 px-3 h-8 rounded-md text-sm font-medium ${pref === k ? 'bg-surface shadow-card text-text' : 'text-text-muted hover:text-text'}`}>
            <Icon size={16} aria-hidden />{l}
          </button>
        ))}
      </div>
    </section>
  );
}

const LOCK_TIMES: [number, string][] = [[0, 'nur beim Öffnen'], [2, 'nach 2 Minuten'], [5, 'nach 5 Minuten'], [10, 'nach 10 Minuten'], [30, 'nach 30 Minuten']];

function LockCard() {
  const lock = useLockState();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [current, setCurrent] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [changing, setChanging] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (lock.enabled && !(await verifyPin(current))) throw new Error('Die bisherige PIN stimmt nicht.');
      if (pin !== pin2) throw new Error('Die beiden Eingaben stimmen nicht überein.');
      await setLock(pin, lock.enabled ? lock.minutes : minutes);
      setPin(''); setPin2(''); setCurrent(''); setChanging(false);
      setMsg({ ok: true, text: lock.enabled ? 'PIN geändert.' : 'App-Sperre ist eingeschaltet.' });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  const remove = async () => {
    setMsg(null);
    if (!(await verifyPin(current))) { setMsg({ ok: false, text: 'Bitte zum Ausschalten die aktuelle PIN eingeben.' }); return; }
    clearLock(); setCurrent('');
    setMsg({ ok: true, text: 'App-Sperre ist ausgeschaltet.' });
  };

  const pinFields = (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label={lock.enabled ? 'Neue PIN' : 'PIN oder Kennwort'}><input className="input" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
      <Field label="Wiederholen"><input className="input" type="password" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value)} /></Field>
    </div>
  );

  return (
    <section className="card p-5 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Lock size={16} aria-hidden />App-Sperre</h2>
      <p className="text-sm text-text-muted">Fragt beim Öffnen und nach einer Pause eine PIN ab, damit niemand am PC einfach in deine Finanzen schaut.
        Die PIN gilt nur in diesem Browser und steckt nicht in der Sicherung. Die Daten selbst werden dadurch nicht verschlüsselt.</p>
      {!lock.enabled ? (
        <form onSubmit={save} className="space-y-3">
          {pinFields}
          <Field label="Automatisch sperren">
            <select className="input w-56" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {LOCK_TIMES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
            </select>
          </Field>
          <button className="btn-primary" type="submit" disabled={!pin}>Sperre einschalten</button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Automatisch sperren">
              <select className="input w-56" value={lock.minutes} onChange={(e) => setLockMinutes(Number(e.target.value))}>
                {LOCK_TIMES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
            </Field>
            <button className="btn-secondary" type="button" onClick={lockNow}><Lock size={16} />Jetzt sperren</button>
          </div>
          <form onSubmit={save} className="space-y-3">
            <Field label="Aktuelle PIN"><input className="input sm:w-64" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            {changing && pinFields}
            <div className="flex flex-wrap gap-2">
              {changing ? <button className="btn-primary" type="submit" disabled={!pin || !current}>PIN ändern</button>
                : <button className="btn-secondary" type="button" onClick={() => setChanging(true)}>PIN ändern …</button>}
              <button className="btn-ghost text-danger" type="button" onClick={() => void remove()} disabled={!current}>Sperre ausschalten</button>
            </div>
          </form>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`} role="status">{msg.text}</p>}
    </section>
  );
}
