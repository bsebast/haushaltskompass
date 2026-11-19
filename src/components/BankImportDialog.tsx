import { useMemo, useState } from 'react';
import { useBook, useQuery } from '../state';
import { Modal, Field, ErrorNote, Money } from './ui';
import { listAccounts, listCategories } from '../db/repo';
import { parseBankCsv, planBankImport, commitBankImport, suggestAccount, type BankStatement, type BankCommitResult } from '../db/bankcsv';
import { pendingSuggestedRules } from '../db/ruleSuggestions';
import { formatDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { isXls, xlsToCsv } from '../lib/xls';
import { isXlsx, xlsxToCsv } from '../lib/xlsx';

const NEW = '__new__';

/** Kontoumsätze aus dem CSV-Export der Bank übernehmen (Vorschau, dann Import). */
export default function BankImportDialog({ onClose }: { onClose: () => void }) {
  const book = useBook();
  const accounts = useQuery((b) => listAccounts(b, true));
  const cats = useQuery(listCategories);
  const [st, setSt] = useState<BankStatement | null>(null);
  const [account, setAccount] = useState('');
  const [useSuggestions, setUseSuggestions] = useState(true);
  const [includePossible, setIncludePossible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BankCommitResult | null>(null);

  const extra = useMemo(() => (useSuggestions ? pendingSuggestedRules(book) : []), [book, useSuggestions, st]);
  const plan = useMemo(() => (st ? planBankImport(book, st, account && account !== NEW ? account : null, extra) : null), [book, st, account, extra]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setSt(null);
    try {
      const buf = await f.arrayBuffer();
      let text: string;
      if (isXls(buf)) text = xlsToCsv(buf);
      else if (isXlsx(buf)) text = await xlsxToCsv(buf);
      else {
        text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
      }
      const s = parseBankCsv(text);
      setAccount(suggestAccount(book, s) ?? NEW);
      setSt(s);
    } catch (e) { setError((e as Error).message); }
  };

  const commit = () => {
    if (!st) return;
    try {
      setDone(commitBankImport(book, st, {
        accountId: account === NEW ? null : account, includePossible, extraRules: extra,
      }));
    } catch (e) { setError((e as Error).message); }
  };

  const toImport = plan ? plan.newCount + (includePossible ? plan.possible : 0) : 0;
  const target = accounts.find((a) => a.id === account);

  return (
    <Modal title="Kontoumsätze importieren" onClose={onClose} wide footer={
      done ? <button className="btn-primary" onClick={onClose}>Fertig</button> : (
        <>
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={!toImport || !account} onClick={commit}>{toImport} Buchungen übernehmen</button>
        </>
      )
    }>
      {done ? (
        <div className="text-sm space-y-2">
          <p>{done.imported} Buchungen wurden übernommen{done.transfers ? `, davon ${done.transfers} als Umbuchung` : ''}.</p>
          <p>Kontostand jetzt: <strong><Money cents={done.balance} colored={false} /></strong>
            {st?.endBalance != null && (done.balance === st.endBalance ? ' – stimmt mit dem Saldo der Bank überein.' : ` (laut Bank ${formatCents(st.endBalance)})`)}</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-text-muted">CSV-Export der Umsätze aus dem Online-Banking, z. B. bei Volksbanken unter Umsätze → Export → CSV, bei der comdirect unter Umsätze → Export als CSV. Kreditkarten-Umsätze können auch als Excel-Datei (.xls oder .xlsx) eingelesen werden. Bereits importierte Buchungen werden erkannt und nicht doppelt übernommen.</p>
          <Field label="Datei"><input type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input py-1" onChange={(e) => read(e.target.files?.[0])} /></Field>
          {st && plan && (
            <>
              <div className="rounded-md bg-surface-2 p-3 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                <div>Konto laut Datei: <strong>{st.accountName ?? '–'}</strong>{st.iban && <span className="text-text-muted"> · …{st.iban.slice(-4)}</span>}</div>
                <div>Zeitraum: <strong>{formatDate(st.from)} – {formatDate(st.to)}</strong></div>
                <div>Buchungen in der Datei: <strong>{st.rows.length}</strong></div>
                {st.endBalance != null && <div>Endsaldo: <strong><Money cents={st.endBalance} colored={false} /></strong></div>}
              </div>
              <Field label="In welches Konto?" hint={target?.iban ? undefined : st.iban ? 'Die IBAN wird beim Konto gespeichert, damit es beim nächsten Import automatisch erkannt wird.' : undefined}>
                <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.owner ? ` · ${a.owner}` : ''}{a.bank ? ` (${a.bank})` : ''}</option>)}
                  <option value={NEW}>Neues Konto „{st.accountName ?? 'Girokonto'}“ anlegen</option>
                </select>
              </Field>
              <ul className="space-y-1">
                <li><strong>{plan.newCount}</strong> neue Buchungen, davon {plan.categorized} mit Kategorie und {plan.contracts} einem Vertrag zugeordnet</li>
                {plan.transfers > 0 && <li><strong>{plan.transfers}</strong> Überweisungen zwischen eigenen Konten werden als Umbuchung mit der schon vorhandenen Gegenbuchung verknüpft (zählen nicht als Einnahme oder Ausgabe)</li>}
                {plan.depot > 0 && <li><strong>{plan.depot}</strong> Wertpapierkäufe und -verkäufe werden als Umbuchung zum Depot „{plan.depotName}“ erfasst</li>}
                {plan.duplicates > 0 && <li><strong>{plan.duplicates}</strong> schon importiert, werden übersprungen</li>}
                {plan.possible > 0 && (
                  <li className="text-warning">
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={includePossible} onChange={(e) => setIncludePossible(e.target.checked)} />
                      <span><strong>{plan.possible}</strong> mögliche Dubletten (gleicher Betrag, ±3 Tage, schon von Hand erfasst) trotzdem übernehmen</span></label>
                  </li>
                )}
                {plan.snapshotFixes.length > 0 && (
                  <li>{plan.snapshotFixes.length} erfasste Kontostände weichen vom Saldo der Bank ab und werden angeglichen
                    ({plan.snapshotFixes.map((f) => `${formatDate(f.date)}: ${formatCents(f.old)} → ${formatCents(f.bank)}`).join(', ')})</li>
                )}
                {st.warnings.map((w) => <li key={w} className="text-warning">{w}</li>)}
              </ul>
              <label className="flex items-center gap-2"><input type="checkbox" checked={useSuggestions} onChange={(e) => setUseSuggestions(e.target.checked)} />
                Vorschlagsregeln für häufige Händler und Versorger mit anlegen (Edeka, Telekom, Apotheke …)</label>
              <div className="border border-border rounded-md max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 sticky top-0"><tr><th className="text-left p-2">Datum</th><th className="text-left p-2">Empfänger</th><th className="text-left p-2">Kategorie</th><th className="text-right p-2">Betrag</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {[...plan.rows].reverse().slice(0, 300).map((r) => (
                      <tr key={r.hash} className={r.status === 'duplicate' || (r.status === 'possible' && !includePossible) ? 'opacity-50' : ''}>
                        <td className="p-2 whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                        <td className="p-2 max-w-0 w-full">
                          <div className="truncate">{r.payee}</div>
                          {r.status === 'duplicate' && <div className="text-text-muted">schon importiert</div>}
                          {r.status === 'possible' && <div className="text-warning">mögliche Dublette zu „{r.match?.payee ?? '–'}“ vom {formatDate(r.match!.date)}</div>}
                          {r.contractName && <div className="text-text-muted">Vertrag: {r.contractName}</div>}
                          {r.transfer && <div className="text-text-muted">Umbuchung {r.amount < 0 ? 'an' : 'von'} {r.transfer.accountName}{r.transfer.txId ? ` (Gegenbuchung vom ${formatDate(r.transfer.date)})` : ''}</div>}
                        </td>
                        <td className="p-2 whitespace-nowrap">{r.transfer ? 'Umbuchung' : r.categoryId ? catName.get(r.categoryId) : <span className="text-warning">offen</span>}</td>
                        <td className="p-2 text-right"><Money cents={r.amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.rows.length > 300 && <p className="p-2 text-xs text-text-muted">Die Vorschau zeigt die neuesten 300 Buchungen.</p>}
              </div>
            </>
          )}
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
