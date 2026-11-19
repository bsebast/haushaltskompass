import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useBookCtx } from '../state';
import { Field, ErrorNote } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { saveAccount } from '../db/repo';
import { ACCOUNT_TYPES, type AccountType } from '../db/types';
import { seedDemo } from '../db/demo';

export default function Setup() {
  const { create, load } = useBookCtx();
  const navigate = useNavigate();
  const [name, setName] = useState('Unser Haushalt');
  const [owner, setOwner] = useState('');
  const [accName, setAccName] = useState('Girokonto');
  const [accType, setAccType] = useState<AccountType>('checking');
  const [opening, setOpening] = useState<number | null>(0);
  const [negative, setNegative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!name.trim()) throw new Error('Bitte einen Namen für das Haushaltsbuch eingeben.');
      const b = create(name.trim(), owner.trim() || undefined);
      saveAccount(b, { name: accName, type: accType, owner: owner || null, opening_balance: (negative ? -1 : 1) * (opening ?? 0) });
      saveAccount(b, { name: 'Bargeld', type: 'cash', owner: owner || null });
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const demo = () => {
    const b = create('Beispielhaushalt');
    seedDemo(b);
    navigate('/');
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      load(new Uint8Array(await f.arrayBuffer()));
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-full grid place-items-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-6">
          <Compass className="text-accent" size={28} aria-hidden />
          <span className="text-xl font-semibold">Haushaltskompass</span>
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Neues Haushaltsbuch</h1>
            <p className="text-sm text-text-muted">Alle Daten bleiben auf diesem Gerät. Du brauchst kein Konto und keine Internetverbindung.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name des Haushaltsbuchs"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Inhaber (optional)"><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
          </div>
          <fieldset className="border-t border-border pt-4">
            <legend className="text-sm font-medium pr-2">Erstes Konto</legend>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <Field label="Kontoname"><input className="input" value={accName} onChange={(e) => setAccName(e.target.value)} /></Field>
              <Field label="Kontoart">
                <select className="input" value={accType} onChange={(e) => setAccType(e.target.value as AccountType)}>
                  {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Aktueller Kontostand"><AmountInput value={opening} onChange={setOpening} /></Field>
              <label className="flex items-center gap-2 text-sm self-end h-9">
                <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> Konto ist im Minus
              </label>
            </div>
            <p className="text-xs text-text-muted mt-2">Ein Bargeldkonto wird automatisch dazu angelegt.</p>
          </fieldset>
          <ErrorNote error={error} />
          <button type="submit" className="btn-primary w-full">Haushaltsbuch anlegen</button>
        </form>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 text-sm">
          <button className="text-accent underline-offset-2 hover:underline" onClick={demo}>Mit Beispieldaten ausprobieren</button>
          <label className="text-accent underline-offset-2 hover:underline cursor-pointer">
            Sicherung öffnen …
            <input type="file" accept=".hkb,.sqlite,.db" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}
