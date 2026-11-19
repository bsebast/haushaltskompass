import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Modal, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { listAccounts, saveAccount, deleteAccount } from '../db/repo';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../db/types';
import { useTxDialog } from '../components/Layout';

export default function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useQuery((b) => listAccounts(b, showArchived), [showArchived]);
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const { openNew } = useTxDialog();
  const total = accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <PageHeader title="Konten" subtitle={`${accounts.filter((a) => !a.archived).length} Konten · Gesamt`} actions={
        <>
          <button className="btn-secondary" onClick={() => openNew('transfer')}>Umbuchung</button>
          <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Konto anlegen</button>
        </>
      } />
      <div className="card divide-y divide-border">
        {accounts.length === 0 && <Empty title="Noch keine Konten" action={<button className="btn-primary" onClick={() => setEdit('new')}>Konto anlegen</button>} />}
        {accounts.map((a) => (
          <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${a.archived ? 'opacity-60' : ''}`}>
            <div className="min-w-0 flex-1">
              <Link to={`/buchungen?konto=${a.id}`} className="font-medium hover:underline">{a.name}</Link>
              <div className="text-xs text-text-muted">{ACCOUNT_TYPES[a.type]}{a.owner ? ` · ${a.owner}` : ''}{a.archived ? ' · archiviert' : ''}</div>
            </div>
            <Money cents={a.balance} className="font-semibold" />
            <button className="btn-ghost w-9 px-0" aria-label={`${a.name} bearbeiten`} onClick={() => setEdit(a)}><Pencil size={16} /></button>
          </div>
        ))}
        {accounts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-surface-2 rounded-b-lg">
            <span className="text-sm font-medium">Summe aller aktiven Konten</span>
            <Money cents={total} className="font-semibold" />
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted mt-3">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte Konten zeigen
      </label>
      {edit && <AccountDialog account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function AccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const book = useBook();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [owner, setOwner] = useState(account?.owner ?? '');
  const [iban, setIban] = useState(account?.iban ?? '');
  const [opening, setOpening] = useState<number | null>(account ? Math.abs(account.opening_balance) : 0);
  const [negative, setNegative] = useState((account?.opening_balance ?? 0) < 0);
  const [archived, setArchived] = useState(!!account?.archived);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      saveAccount(book, { id: account?.id, name, type, owner: owner || null, iban: iban.replace(/\s/g, '') || null, opening_balance: (negative ? -1 : 1) * (opening ?? 0), archived });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = () => {
    if (account && window.confirm(`Konto „${account.name}“ mit allen Buchungen löschen? Das lässt sich nicht rückgängig machen.`)) {
      deleteAccount(book, account.id);
      onClose();
    }
  };

  return (
    <Modal title={account ? 'Konto bearbeiten' : 'Konto anlegen'} onClose={onClose} footer={
      <>
        {account && <button className="btn-ghost text-danger mr-auto" onClick={remove}>Löschen</button>}
        <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={save}>Speichern</button>
      </>
    }>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Kontoname"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Kontoart">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Inhaber"><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
        </div>
        <Field label="IBAN (optional)"><input className="input" value={iban} onChange={(e) => setIban(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <Field label="Anfangssaldo"><AmountInput value={opening} onChange={setOpening} /></Field>
          <label className="flex items-center gap-2 text-sm h-9"><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> im Minus</label>
        </div>
        {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Konto archivieren (wird ausgeblendet)</label>}
        <button type="submit" hidden />
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
