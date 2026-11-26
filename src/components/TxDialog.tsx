import { useMemo, useState } from 'react';
import { Plus, Trash2, Paperclip } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { Modal, Field, ErrorNote, Money } from './ui';
import AmountInput from './AmountInput';
import CategorySelect from './CategorySelect';
import {
  listAccounts, saveTransaction, saveTransfer, linkCounterpart, getSplits, getTransfer, deleteTransaction, payeeSuggestions,
} from '../db/repo';
import type { Transaction } from '../db/types';
import { listTxDocuments, updateTxDocuments, MAX_DOC } from '../db/inventory';
import { openDocument } from '../lib/documents';
import { listCollections, collectionIds, setTxCollections } from '../db/collections';
import { today, parseDate, formatDate } from '../lib/dates';

export type TxMode = 'expense' | 'income' | 'transfer';

interface SplitRow { key: number; category_id: string | null; amount: number | null; note: string }

export default function TxDialog({ onClose, edit, initialMode = 'expense', initialAccount }: {
  onClose: () => void; edit?: Transaction | null; initialMode?: TxMode; initialAccount?: string | null;
}) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b));
  const payees = useQuery(payeeSuggestions);
  const transfer = edit?.transfer_id ? getTransfer(book, edit.transfer_id) : null;

  const [mode, setMode] = useState<TxMode>(edit ? (edit.transfer_id ? 'transfer' : edit.amount > 0 ? 'income' : 'expense') : initialMode);
  const [accountId, setAccountId] = useState<string>(transfer?.from_account ?? edit?.account_id ?? initialAccount ?? accounts[0]?.id ?? '');
  const [toAccount, setToAccount] = useState<string>(transfer?.to_account ?? accounts.find((a) => a.id !== accountId)?.id ?? '');
  const [dateText, setDateText] = useState(formatDate(edit?.date ?? today()));
  const [amount, setAmount] = useState<number | null>(edit ? Math.abs(edit.amount) : null);
  const [payee, setPayee] = useState(edit?.payee ?? '');
  const [purpose, setPurpose] = useState(edit?.purpose ?? '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(edit?.category_id ?? null);
  const [lumpSum, setLumpSum] = useState(!!edit?.is_lump_sum);
  const [splits, setSplits] = useState<SplitRow[]>(() =>
    edit && !edit.transfer_id && edit.split_count
      ? getSplits(book, edit.id).map((s, i) => ({ key: i, category_id: s.category_id, amount: Math.abs(s.amount), note: s.note ?? '' }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  /** Belege: vorhandene (ohne entfernte) und neu gewählte, die beim Speichern angehängt werden */
  const [docs, setDocs] = useState(() => (edit && !edit.transfer_id ? listTxDocuments(book, edit.id) : []));
  const [removedDocs, setRemovedDocs] = useState<string[]>([]);
  const collections = useMemo(() => listCollections(book, false), [book]);
  const [colls, setColls] = useState<string[]>(() => (edit && !edit.transfer_id ? collectionIds(book, edit.id) : []));
  const [newDocs, setNewDocs] = useState<{ key: number; filename: string; mime: string; data: Uint8Array }[]>([]);

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: { key: number; filename: string; mime: string; data: Uint8Array }[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_DOC) { setError(`„${f.name}“ ist größer als 20 MB.`); continue; }
      added.push({ key: Date.now() + Math.random(), filename: f.name, mime: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) });
    }
    setNewDocs((d) => [...d, ...added]);
  };

  const splitSum = splits.reduce((a, s) => a + (s.amount ?? 0), 0);
  const kind = mode === 'income' ? 'income' : 'expense';
  const payeeMap = useMemo(() => new Map(payees.map((p) => [p.payee.toLowerCase(), p.category_id])), [payees]);

  const submit = (again: boolean) => {
    setError(null);
    const date = parseDate(dateText);
    try {
      if (!date) throw new Error('Bitte ein gültiges Datum eingeben (TT.MM.JJJJ).');
      if (!amount) throw new Error('Bitte einen Betrag eingeben.');
      if (!accountId) throw new Error('Bitte zuerst ein Konto anlegen.');
      if (mode === 'transfer' && edit && !edit.transfer_id) {
        // vorhandene Buchung wird zur Umbuchung: Gegenbuchung im anderen Konto verknüpfen oder anlegen
        if (accountId !== edit.account_id && toAccount !== edit.account_id) throw new Error('Eines der beiden Konten muss das Konto der Buchung sein.');
        linkCounterpart(book, edit.id, accountId === edit.account_id ? toAccount : accountId);
      } else if (mode === 'transfer') {
        saveTransfer(book, { transfer_id: transfer?.transfer_id, from_account: accountId, to_account: toAccount, date, amount, note: note || null });
      } else {
        const sign = mode === 'expense' ? -1 : 1;
        if (edit?.transfer_id) deleteTransaction(book, edit.id);
        const txId = saveTransaction(book, {
          id: edit && !edit.transfer_id ? edit.id : undefined,
          account_id: accountId, date, amount: sign * amount,
          payee: payee.trim() || null, purpose: purpose.trim() || null, note: note.trim() || null,
          category_id: categoryId, is_lump_sum: lumpSum,
          splits: splits.length ? splits.map((s) => ({ category_id: s.category_id, amount: sign * (s.amount ?? 0), note: s.note || null })) : undefined,
        });
        updateTxDocuments(book, txId, newDocs, removedDocs);
        if (collections.length || colls.length) setTxCollections(book, txId, colls);
      }
      if (again) {
        setAmount(null); setPayee(''); setPurpose(''); setNote(''); setCategoryId(null); setSplits([]); setLumpSum(false);
        setDocs([]); setNewDocs([]); setRemovedDocs([]);
        (document.getElementById('tx-amount') as HTMLInputElement | null)?.focus();
      } else onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = () => {
    if (edit && confirmDelete()) {
      deleteTransaction(book, edit.id);
      onClose();
    }
  };

  const tabs: [TxMode, string][] = [['expense', 'Ausgabe'], ['income', 'Einnahme'], ['transfer', 'Umbuchung']];

  return (
    <Modal
      title={edit ? 'Buchung bearbeiten' : 'Neue Buchung'}
      onClose={onClose}
      wide
      footer={
        <>
          {edit && <button className="btn-ghost text-danger mr-auto" onClick={remove}><Trash2 size={16} />Löschen</button>}
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          {!edit && <button className="btn-secondary" onClick={() => submit(true)}>Speichern & weitere</button>}
          <button className="btn-primary" onClick={() => submit(false)}>Speichern</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-4">
        <div role="tablist" className="inline-flex rounded-md bg-surface-2 p-1">
          {tabs.map(([m, label]) => (
            <button type="button" role="tab" aria-selected={mode === m} key={m} onClick={() => setMode(m)}
              className={`px-3 h-8 rounded text-sm font-medium ${mode === m ? 'bg-surface shadow-card text-text' : 'text-text-muted'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Betrag"><AmountInput id="tx-amount" value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Datum">
            <input className="input" value={dateText} onChange={(e) => setDateText(e.target.value)} placeholder="TT.MM.JJJJ" />
          </Field>
          <Field label={mode === 'transfer' ? 'Von Konto' : 'Konto'}>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>

        {mode === 'transfer' ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Auf Konto">
              <select className="input" value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Notiz"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={mode === 'expense' ? 'Empfänger' : 'Auftraggeber'}>
                <input className="input" list="payees" value={payee}
                  onChange={(e) => {
                    setPayee(e.target.value);
                    const c = payeeMap.get(e.target.value.toLowerCase());
                    if (c && !categoryId) setCategoryId(c);
                  }} />
                <datalist id="payees">{payees.map((p) => <option key={p.payee} value={p.payee} />)}</datalist>
              </Field>
              {!splits.length && (
                <Field label="Kategorie" hint={!categoryId ? 'Leer lassen: Regeln ordnen automatisch zu.' : undefined}>
                  <CategorySelect value={categoryId} onChange={setCategoryId} kind={kind} />
                </Field>
              )}
            </div>
            <Field label="Verwendungszweck"><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>

            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Aufteilung auf mehrere Kategorien</span>
                <button type="button" className="btn-ghost h-8" onClick={() => setSplits((s) => [...s, { key: Date.now(), category_id: s.length ? null : categoryId, amount: s.length ? null : amount, note: '' }])}>
                  <Plus size={16} />Teil hinzufügen
                </button>
              </div>
              {splits.length > 0 && (
                <div className="mt-3 space-y-2">
                  {splits.map((s, i) => (
                    <div key={s.key} className="grid grid-cols-[1fr_120px_36px] gap-2 items-center">
                      <CategorySelect ariaLabel={`Kategorie Teil ${i + 1}`} value={s.category_id} kind={kind}
                        onChange={(v) => setSplits((all) => all.map((x) => (x.key === s.key ? { ...x, category_id: v } : x)))} />
                      <AmountInput ariaLabel={`Betrag Teil ${i + 1}`} value={s.amount}
                        onChange={(v) => setSplits((all) => all.map((x) => (x.key === s.key ? { ...x, amount: v } : x)))} />
                      <button type="button" className="btn-ghost w-9 px-0" aria-label="Teil entfernen" onClick={() => setSplits((all) => all.filter((x) => x.key !== s.key))}><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <p className={`text-xs ${splitSum === amount ? 'text-text-muted' : 'text-danger'}`}>
                    Summe der Teile <Money cents={splitSum} colored={false} /> von <Money cents={amount ?? 0} colored={false} />
                    {amount != null && splitSum !== amount && <> · Rest <Money cents={amount - splitSum} colored={false} /></>}
                  </p>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="Notiz"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <label className="flex items-center gap-2 text-sm h-9">
                <input type="checkbox" checked={lumpSum} onChange={(e) => setLumpSum(e.target.checked)} />
                Pauschal (ohne Einzelbeleg)
              </label>
            </div>

            {collections.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sammlungen">
                <span className="text-sm font-medium mr-1">Sammlungen</span>
                {collections.map((c) => {
                  const on = colls.includes(c.id);
                  return (
                    <button key={c.id} type="button" aria-pressed={on}
                      className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-accent text-on-accent border-accent' : 'border-border text-text-muted hover:bg-surface-2'}`}
                      onClick={() => setColls(on ? colls.filter((x) => x !== c.id) : [...colls, c.id])}>{c.name}</button>
                  );
                })}
              </div>
            )}

            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Belege</span>
                <label className="btn-ghost h-8 cursor-pointer"><Paperclip size={16} />Datei anhängen
                  <input type="file" multiple accept="image/*,application/pdf" className="sr-only"
                    onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
                </label>
              </div>
              {(docs.length > 0 || newDocs.length > 0) ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Paperclip size={14} aria-hidden />
                      <button type="button" className="text-accent hover:underline truncate" onClick={() => openDocument(book, d.id)}>{d.filename}</button>
                      <button type="button" className="text-xs text-danger hover:underline ml-auto"
                        onClick={() => { setDocs((all) => all.filter((x) => x.id !== d.id)); setRemovedDocs((r) => [...r, d.id]); }}>entfernen</button>
                    </li>
                  ))}
                  {newDocs.map((d) => (
                    <li key={d.key} className="flex items-center gap-2">
                      <Paperclip size={14} aria-hidden /><span className="truncate">{d.filename}</span><span className="text-xs text-text-muted">neu</span>
                      <button type="button" className="text-xs text-danger hover:underline ml-auto" onClick={() => setNewDocs((all) => all.filter((x) => x.key !== d.key))}>entfernen</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-text-muted mt-1">Kassenzettel, Rechnung oder Quittung als Bild oder PDF. Die Datei wird in der Sicherung mitgespeichert.</p>}
            </div>
          </>
        )}
        <button type="submit" hidden />
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function confirmDelete() {
  return window.confirm('Diese Buchung wirklich löschen?');
}
