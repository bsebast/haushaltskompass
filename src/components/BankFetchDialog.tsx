import { useEffect, useMemo, useRef, useState } from 'react';
import { useBook, useQuery } from '../state';
import { Modal, Field, ErrorNote } from './ui';
import { listAccounts } from '../db/repo';
import { FINTS_BANKS, blzFromIban, defaultFetchFrom, fintsToStatement, guessFintsBank, type FintsAccountData } from '../db/fints';
import type { BankStatement } from '../db/bankcsv';
import { fintsApi, type FintsBankAccount, type FintsStep } from '../lib/fintsApi';
import { formatDate } from '../lib/dates';
import BankImportDialog from './BankImportDialog';

const OTHER = '__other__';
type Tan = Extract<FintsStep, { step: 'tan' }>;
type Choose = Extract<FintsStep, { step: 'choose-tan' }>;
type Result = { data: FintsAccountData; st: BankStatement | null; error: string | null; imported: boolean };

/**
 * Umsätze per FinTS direkt von der Bank abrufen. PIN und TAN gehen nur an den lokalen Dienst
 * und werden nirgends gespeichert; die Übernahme läuft über dieselbe Vorschau wie der Dateiimport.
 */
export default function BankFetchDialog({ onClose }: { onClose: () => void }) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b, true));
  // Banken aus den eigenen Konten: eine Zeile je Bankleitzahl
  const banks = useMemo(() => {
    const m = new Map<string, { blz: string; label: string; url: string; userHint: string; tanHint: string }>();
    for (const a of accounts) {
      const blz = blzFromIban(a.iban);
      if (!blz || m.has(blz) || a.archived) continue;
      const g = guessFintsBank(blz, a.bank);
      if (!g) continue;
      m.set(blz, { blz, label: `${a.bank || g.name} (BLZ ${blz})`, url: g.url, userHint: g.userHint, tanHint: g.tanHint });
    }
    return [...m.values()];
  }, [accounts]);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [logins, setLogins] = useState<Record<string, string>>({});
  const [bankSel, setBankSel] = useState('');
  const [blz, setBlz] = useState('');
  const [url, setUrl] = useState('');
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [tan, setTan] = useState<Tan | null>(null);
  const [tanInput, setTanInput] = useState('');
  const [choose, setChoose] = useState<Choose | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<FintsBankAccount[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    fintsApi.config().then((c) => { setConfigured(c.configured); setLogins(c.logins); }).catch((e) => { setConfigured(false); setError((e as Error).message); });
    return () => { if (sessionRef.current) fintsApi.close(sessionRef.current); };
  }, []);

  useEffect(() => {
    if (!bankSel) { if (banks.length) pickBank(banks[0].blz); else setBankSel(OTHER); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks, logins]);

  const pickBank = (v: string) => {
    setBankSel(v);
    const b = banks.find((x) => x.blz === v);
    if (b) { setBlz(b.blz); setUrl(b.url); setUserId(logins[b.blz] ?? ''); }
  };
  const sel = banks.find((x) => x.blz === bankSel) ?? FINTS_BANKS.find((x) => x.url === url);
  const appAccount = (iban: string | null) => (iban ? accounts.find((a) => a.iban?.replace(/\s/g, '').toUpperCase() === iban.replace(/\s/g, '').toUpperCase()) : undefined);

  /** Verarbeitet jede Antwort des Dienstes und setzt den Abruf der ausgewählten Konten fort. */
  const handle = async (step: FintsStep, pendingQueue: string[]): Promise<void> => {
    setTan(null); setChoose(null); setTanInput('');
    if (step.step === 'error') { setError(step.message); setQueue(pendingQueue); return; }
    if (step.step === 'tan') { setTan(step); setQueue(pendingQueue); return; }
    if (step.step === 'choose-tan') { setChoose(step); return; }
    if (step.step === 'accounts') {
      setBankName(step.bankName);
      setBankAccounts(step.accounts);
      const p: Record<string, boolean> = {};
      const f: Record<string, string> = {};
      for (const a of step.accounts) {
        p[a.key] = a.statements;
        f[a.key] = defaultFetchFrom(book, appAccount(a.iban)?.id ?? null);
      }
      setPicked(p); setFrom(f);
      return;
    }
    // Umsätze eines Kontos sind da
    const [key, ...rest] = pendingQueue;
    if (key) {
      let st: BankStatement | null = null;
      let err: string | null = null;
      try { st = fintsToStatement(step.data); } catch (e) { err = (e as Error).message; }
      setResults((r) => ({ ...r, [key]: { data: step.data, st, error: err, imported: false } }));
    }
    await next(rest);
  };

  const next = async (q: string[]) => {
    setQueue(q);
    if (!q.length || !sessionRef.current) return;
    await handle(await fintsApi.statements(sessionRef.current, q[0], from[q[0]]), q);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const connect = () => run(async () => {
    const r = await fintsApi.connect({ blz, url, userId, pin, remember });
    setPin('');
    if (r.step !== 'error') { setSession(r.session); sessionRef.current = r.session; }
    await handle(r, []);
  });

  const sendTan = (value: string) => run(async () => {
    if (!session) return;
    await handle(await fintsApi.tan(session, value), queue);
  });

  // App-Freigabe: regelmäßig nachfragen, bis die Bank die Freigabe bestätigt (höchstens 5 Minuten)
  useEffect(() => {
    if (!tan?.decoupled || !session) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started > 5 * 60 * 1000) { setError('Die Freigabe ist nicht rechtzeitig eingegangen. Bitte erneut versuchen.'); return; }
      try {
        const r = await fintsApi.tan(session, undefined);
        if (stopped) return;
        if (r.step === 'tan') { timer = setTimeout(tick, r.pollSeconds * 1000); return; }
        await handle(r, queue);
      } catch (e) { if (!stopped) setError((e as Error).message); }
    };
    let timer = setTimeout(tick, Math.max(3, tan.pollSeconds) * 1000);
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tan, session]);

  const fetchSelected = () => run(async () => {
    const q = (bankAccounts ?? []).filter((a) => picked[a.key] && a.statements).map((a) => a.key);
    await next(q);
  });

  const saveProduct = async (id: string) => run(async () => {
    const r = await fintsApi.setProductId(id);
    setConfigured(r.configured);
  });

  if (preview && results[preview]?.st) {
    return <BankImportDialog statement={results[preview].st!} onClose={(done) => {
      if (done) setResults((r) => ({ ...r, [preview]: { ...r[preview], imported: true } }));
      setPreview(null);
    }} />;
  }

  const resultKeys = Object.keys(results);
  const footer = (
    <>
      <button className="btn-secondary" onClick={onClose}>{resultKeys.length ? 'Schließen' : 'Abbrechen'}</button>
      {configured && !session && <button className="btn-primary" disabled={busy || !blz || !url || !userId || !pin} onClick={connect}>{busy ? 'Verbinde …' : 'Verbinden'}</button>}
      {bankAccounts && !tan && !choose && !queue.length && !resultKeys.length && (
        <button className="btn-primary" disabled={busy || !Object.values(picked).some(Boolean)} onClick={fetchSelected}>{busy ? 'Rufe ab …' : 'Umsätze abrufen'}</button>
      )}
    </>
  );

  return (
    <Modal title="Umsätze von der Bank abrufen" onClose={onClose} wide footer={footer}>
      <div className="space-y-3 text-sm">
        {configured === false && <ProductSetup onSave={saveProduct} busy={busy} />}

        {configured && !session && (
          <>
            <p className="text-text-muted">Die App verbindet sich per FinTS direkt mit der Bank, wie ein Banking-Programm. PIN und TAN werden nicht gespeichert.</p>
            <Field label="Bank">
              <select className="input" value={bankSel} onChange={(e) => (e.target.value === OTHER ? (setBankSel(OTHER), setBlz(''), setUrl(''), setUserId('')) : pickBank(e.target.value))}>
                {banks.map((b) => <option key={b.blz} value={b.blz}>{b.label}</option>)}
                <option value={OTHER}>Andere Bank …</option>
              </select>
            </Field>
            {bankSel === OTHER && (
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Zugang">
                  <select className="input" value={FINTS_BANKS.find((b) => b.url === url)?.key ?? ''} onChange={(e) => setUrl(FINTS_BANKS.find((b) => b.key === e.target.value)?.url ?? '')}>
                    <option value="">eigene Adresse</option>
                    {FINTS_BANKS.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Bankleitzahl"><input className="input" inputMode="numeric" value={blz} onChange={(e) => { setBlz(e.target.value.replace(/\D/g, '').slice(0, 8)); setUserId(logins[e.target.value] ?? userId); }} /></Field>
                <div className="sm:col-span-2"><Field label="FinTS-Adresse der Bank"><input className="input" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://…" /></Field></div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Anmeldename" hint={sel?.userHint}><input className="input" autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} /></Field>
              <Field label="PIN" hint={sel?.tanHint}><input className="input" type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pin && connect()} /></Field>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Anmeldenamen auf diesem PC merken (die PIN nie)</label>
          </>
        )}

        {choose && (
          <TanChoice methods={choose.methods} busy={busy} onPick={(id, media) => run(async () => { if (session) await handle(await fintsApi.chooseTan(session, id, media), queue); })} />
        )}

        {tan && (
          <div className="rounded-md bg-surface-2 p-3 space-y-2">
            <p className="whitespace-pre-line">{tan.challenge}</p>
            {tan.photo && <img src={tan.photo} alt="photoTAN-Grafik" className="max-w-[220px] bg-white p-2 rounded" />}
            {tan.decoupled ? (
              <p className="text-text-muted">Bitte in der Banking-App freigeben. Danach geht es hier von selbst weiter.</p>
            ) : (
              <div className="flex items-end gap-2">
                <Field label="TAN"><input className="input" autoComplete="one-time-code" value={tanInput} onChange={(e) => setTanInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tanInput && sendTan(tanInput)} /></Field>
                <button className="btn-primary" disabled={busy || !tanInput} onClick={() => sendTan(tanInput)}>Senden</button>
              </div>
            )}
            {tan.hhduc && !tan.photo && <p className="text-xs text-text-muted">chipTAN optisch wird nicht unterstützt. Bitte bei der Bank ein App-Verfahren wählen.</p>}
          </div>
        )}

        {bankAccounts && !tan && !choose && (
          <div className="space-y-2">
            <p>Konten bei <strong>{bankName ?? 'der Bank'}</strong>:</p>
            <ul className="divide-y divide-border border border-border rounded-md">
              {bankAccounts.map((a) => {
                const app = appAccount(a.iban);
                const res = results[a.key];
                return (
                  <li key={a.key} className="p-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="flex items-center gap-2 grow min-w-0">
                      <input type="checkbox" disabled={!a.statements || !!resultKeys.length} checked={!!picked[a.key]} onChange={(e) => setPicked((p) => ({ ...p, [a.key]: e.target.checked }))} />
                      <span className="truncate">{a.name ?? 'Konto'} {a.iban ? `· …${a.iban.slice(-4)}` : `· ${a.accountNumber}`}
                        <span className="text-text-muted"> → {app ? app.name : 'neues Konto'}</span>
                        {!a.statements && <span className="text-text-muted"> (keine Umsätze per FinTS)</span>}</span>
                    </label>
                    {a.statements && !res && picked[a.key] && (
                      <label className="flex items-center gap-1 text-xs text-text-muted">ab
                        <input type="date" className="input py-0.5 w-auto" value={from[a.key] ?? ''} disabled={!!queue.length} onChange={(e) => setFrom((f) => ({ ...f, [a.key]: e.target.value }))} />
                      </label>
                    )}
                    {queue[0] === a.key && <span className="text-xs text-text-muted">wird abgerufen …</span>}
                    {res && (res.error ? <span className="text-xs text-warning">{res.error}</span> : res.imported
                      ? <span className="text-xs text-success">übernommen</span>
                      : <button className="btn-primary py-1" onClick={() => setPreview(a.key)}>{res.st!.rows.length} Umsätze ({formatDate(res.st!.from)} – {formatDate(res.st!.to)}) prüfen</button>)}
                  </li>
                );
              })}
            </ul>
            {queue.length > 0 && !busy && !tan && (
              <button className="btn-secondary" onClick={() => run(() => next(queue))}>Abruf fortsetzen</button>
            )}
          </div>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function TanChoice({ methods, busy, onPick }: { methods: Choose['methods']; busy: boolean; onPick: (id: number, media?: string) => void }) {
  const best = methods.find((m) => m.decoupled) ?? methods[0];
  const [id, setId] = useState(best.id);
  const m = methods.find((x) => x.id === id) ?? best;
  const [media, setMedia] = useState(m.media[0] ?? '');
  return (
    <div className="rounded-md bg-surface-2 p-3 space-y-2">
      <p>Welches TAN-Verfahren soll verwendet werden?</p>
      <select className="input" value={id} onChange={(e) => { const n = Number(e.target.value); setId(n); setMedia(methods.find((x) => x.id === n)?.media[0] ?? ''); }}>
        {methods.map((x) => <option key={x.id} value={x.id}>{x.name}{x.decoupled ? ' (Freigabe in der App)' : ''}</option>)}
      </select>
      {m.media.length > 1 && (
        <select className="input" value={media} onChange={(e) => setMedia(e.target.value)}>
          {m.media.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      )}
      <button className="btn-primary" disabled={busy} onClick={() => onPick(id, m.media.length ? media : undefined)}>Weiter</button>
    </div>
  );
}

function ProductSetup({ onSave, busy }: { onSave: (id: string) => void; busy: boolean }) {
  const [id, setId] = useState('');
  return (
    <div className="space-y-2">
      <p>Für den direkten Abruf braucht die App eine FinTS-Produktnummer. Die Deutsche Kreditwirtschaft vergibt sie kostenlos nach einer Registrierung (fints.org → Hersteller → Produktregistrierung). Sie wird nur auf diesem PC im Ordner <code>privat</code> gespeichert.</p>
      <div className="flex items-end gap-2">
        <Field label="FinTS-Produktnummer"><input className="input" value={id} onChange={(e) => setId(e.target.value.trim())} /></Field>
        <button className="btn-primary" disabled={busy || id.length < 8} onClick={() => onSave(id)}>Speichern</button>
      </div>
    </div>
  );
}
