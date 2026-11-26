import { useState } from 'react';
import { Lock } from 'lucide-react';
import { unlock } from '../lib/applock';

export default function LockScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await unlock(pin);
    setBusy(false);
    if (!ok) { setError(true); setPin(''); }
  };
  return (
    <div className="h-full min-h-screen grid place-items-center p-6 bg-bg">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-accent-soft text-accent grid place-items-center"><Lock size={22} aria-hidden /></div>
        <h1 className="text-lg font-semibold">Haushaltskompass ist gesperrt</h1>
        <input className="input text-center text-lg tracking-widest" type="password" autoFocus autoComplete="current-password"
          aria-label="PIN oder Kennwort" placeholder="PIN" value={pin} onChange={(e) => { setPin(e.target.value); setError(false); }} />
        {error && <p className="text-sm text-danger" role="alert">Falsche PIN.</p>}
        <button className="btn-primary w-full justify-center" type="submit" disabled={busy || !pin}>Entsperren</button>
        <p className="text-xs text-text-muted">PIN vergessen? Die Sperre gilt nur in diesem Browser. Websitedaten löschen entfernt sie, dabei aber auch das Haushaltsbuch im Browser. Danach die letzte Sicherung (.hkb) einspielen.</p>
      </form>
    </div>
  );
}
