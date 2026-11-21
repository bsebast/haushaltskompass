import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Empty, Modal, Field, ErrorNote } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { listInventory, inventoryInWealth, inventoryTotals } from '../db/inventory';
import { setHoldingAlerts, unitPrice } from '../db/alerts';
import type { Holding } from '../db/types';
import { formatCents } from '../lib/money';
import { BalanceChart } from '../components/charts';
import { listAccounts, listHoldings, listSnapshots } from '../db/repo';
import { balancesAt } from '../db/reports';
import { currentMonth, addMonths, formatDate, monthRange } from '../lib/dates';
import { ACCOUNT_TYPES } from '../db/types';

export default function Wealth() {
  // externe Konten (nur Durchbuchungen) gehören nicht zum Vermögen
  const accounts = useQuery((b) => listAccounts(b).filter((a) => !a.external));
  const allAccounts = useQuery((b) => listAccounts(b, true).filter((a) => !a.external));
  const holdings = useQuery(listHoldings);
  const snaps = useQuery((b) => listSnapshots(b));
  const [owner, setOwner] = useState<string | null>(null); // null = alle
  const owners = useMemo(() => [...new Set(accounts.map((a) => a.owner ?? ''))].sort(), [accounts]);
  const first = snaps[0]?.date.slice(0, 7);
  const start = first && first > addMonths(currentMonth(), -60) ? first : addMonths(currentMonth(), -23);
  const ids = allAccounts.filter((a) => owner === null || (a.owner ?? '') === owner).map((a) => a.id);
  const trend = useQuery((b) => {
    if (!ids.length) return [];
    const months: string[] = [];
    for (let m = start; m <= currentMonth(); m = addMonths(m, 1)) months.push(m);
    const per = balancesAt(b, months.map((m) => monthRange(m).to), ids);
    return months.map((month, i) => ({ month, balance: [...per.values()].reduce((s, arr) => s + arr[i], 0) }));
  }, [start, ids.join()]);

  const byType = new Map<string, number>();
  accounts.filter((a) => owner === null || (a.owner ?? '') === owner).forEach((a) => byType.set(ACCOUNT_TYPES[a.type], (byType.get(ACCOUNT_TYPES[a.type]) ?? 0) + a.balance));
  const shownHoldings = holdings.filter((h) => owner === null || (h.owner ?? '') === owner);
  const hOwners = [...new Set(shownHoldings.map((h) => h.owner ?? ''))];
  const inv = useQuery((b) => (inventoryInWealth(b) ? listInventory(b) : []));
  const invShown = inv.filter((x) => owner === null || (x.owner ?? '') === owner);
  if (invShown.length) byType.set('Inventar (Zeitwert)', inventoryTotals(invShown).value);
  const [alertFor, setAlertFor] = useState<Holding | null>(null);

  if (!accounts.length) return <><PageHeader title="Vermögen" /><div className="card"><Empty title="Noch keine Konten" /></div></>;

  return (
    <>
      <PageHeader title="Vermögen" subtitle="Konten, Depots und Kontostand-Verlauf nach Person." />
      {owners.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Person">
          {[null, ...owners].map((o) => (
            <button key={o ?? '*'} role="tab" aria-selected={owner === o} onClick={() => setOwner(o)}
              className={`px-3 h-8 rounded-full text-sm border ${owner === o ? 'bg-accent text-on-accent border-accent' : 'border-border bg-surface hover:bg-surface-2'}`}>{o === null ? 'Alle' : o || 'Ohne Inhaber'}</button>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <section className="card p-4">
          <div className="text-xs text-text-muted">Gesamtvermögen {owner ?? ''}</div>
          <div className="text-3xl font-semibold mt-1"><Money cents={[...byType.values()].reduce((a, v) => a + v, 0)} /></div>
          <ul className="mt-3 space-y-1 text-sm">
            {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><Money cents={v} /></li>)}
          </ul>
          {owner === null && owners.length > 1 && (
            <ul className="mt-3 pt-3 border-t border-border space-y-1 text-sm">
              {owners.map((o) => <li key={o} className="flex justify-between"><button className="hover:underline" onClick={() => setOwner(o)}>{o || 'Ohne Inhaber'}</button>
                <Money cents={accounts.filter((a) => (a.owner ?? '') === o).reduce((s, a) => s + a.balance, 0)} /></li>)}
            </ul>
          )}
        </section>
        <section className="card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Verlauf (Monatsende)</h2>
          <BalanceChart data={trend} height={240} />
        </section>
      </div>
      <section className="card overflow-x-auto">
        <h2 className="text-sm font-semibold px-4 pt-4">Depotpositionen</h2>
        {shownHoldings.length === 0 ? <p className="px-4 pb-4 pt-2 text-sm text-text-muted">Keine Depotpositionen erfasst.</p> : (
          <table className="w-full text-sm min-w-[720px] mt-2">
            <thead className="bg-surface-2 text-xs text-text-muted">
              <tr><th className="text-left px-4 py-2 font-medium">Wertpapier</th><th className="text-left px-2 font-medium">ISIN / WKN</th><th className="text-right px-2 font-medium">Anzahl</th>
                <th className="text-right px-2 font-medium">Einstand</th><th className="text-right px-2 font-medium">Kurswert</th><th className="text-right px-2 font-medium">Gewinn</th><th className="px-4 font-medium"><span className="sr-only">Kursgrenzen</span></th></tr>
            </thead>
            {hOwners.map((o) => {
              const hs = shownHoldings.filter((h) => (h.owner ?? '') === o);
              const mv = hs.reduce((s, h) => s + (h.market_value ?? 0), 0);
              const cv = hs.reduce((s, h) => s + (h.cost_value ?? 0), 0);
              return (
                <tbody key={o} className="divide-y divide-border">
                  <tr className="bg-surface-2/60"><td colSpan={4} className="px-4 py-1.5 font-semibold">{o || 'Ohne Inhaber'}{hs[0]?.as_of ? <span className="font-normal text-xs text-text-muted"> · Stand {formatDate(hs[0].as_of)}</span> : null}</td>
                    <td className="text-right px-2 font-semibold"><Money cents={mv} colored={false} /></td><td className="text-right px-2 font-semibold">{cv ? <Money cents={mv - cv} /> : null}</td><td /></tr>
                  {hs.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-1.5">{h.name}</td>
                      <td className="px-2 text-xs text-text-muted">{[h.isin, h.wkn].filter(Boolean).join(' / ')}</td>
                      <td className="text-right px-2 tabular-nums">{h.quantity.toLocaleString('de-DE', { maximumFractionDigits: 3 })}</td>
                      <td className="text-right px-2">{h.cost_value != null ? <Money cents={h.cost_value} colored={false} /> : '–'}</td>
                      <td className="text-right px-2">{h.market_value != null ? <Money cents={h.market_value} colored={false} /> : '–'}</td>
                      <td className="text-right px-2">{h.market_value != null && h.cost_value ? <><Money cents={h.market_value - h.cost_value} /> <span className="text-xs text-text-muted">{Math.round(((h.market_value - h.cost_value) / h.cost_value) * 100)} %</span></> : '–'}</td>
                      <td className="px-4 text-right"><HoldingAlertButton h={h} onClick={() => setAlertFor(h)} /></td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        )}
      </section>
      {inv.length === 0 && <p className="text-xs text-text-muted mt-3">Wertgegenstände erfasst du im <Link to="/inventar" className="text-accent hover:underline">Inventar</Link>. Dort lässt sich ihr Zeitwert zum Vermögen hinzunehmen.</p>}
      {alertFor && <HoldingAlertDialog h={alertFor} onClose={() => setAlertFor(null)} />}
    </>
  );
}

function HoldingAlertButton({ h, onClick }: { h: Holding; onClick: () => void }) {
  const p = unitPrice(h);
  const hit = p != null && ((h.alert_below != null && p < h.alert_below) || (h.alert_above != null && p > h.alert_above));
  const set = h.alert_below != null || h.alert_above != null;
  return (
    <button onClick={onClick} aria-label={`Kursgrenzen für ${h.name}`} title={set ? `Kursgrenzen: ${[h.alert_below != null && `unter ${formatCents(h.alert_below)}`, h.alert_above != null && `über ${formatCents(h.alert_above)}`].filter(Boolean).join(', ')}` : 'Kursgrenzen festlegen'}
      className={`inline-flex ${hit ? 'text-danger' : set ? 'text-accent' : 'text-text-muted hover:text-text'}`}><Bell size={15} fill={hit ? 'currentColor' : 'none'} /></button>
  );
}

function HoldingAlertDialog({ h, onClose }: { h: Holding; onClose: () => void }) {
  const book = useBook();
  const [below, setBelow] = useState<number | null>(h.alert_below ?? null);
  const [above, setAbove] = useState<number | null>(h.alert_above ?? null);
  const [error, setError] = useState<string | null>(null);
  const p = unitPrice(h);
  const save = () => {
    try { setHoldingAlerts(book, h.id, below, above); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={`Kursgrenzen: ${h.name}`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
      <button className="btn-primary" onClick={save}>Speichern</button>
    </>}>
      <p className="text-sm text-text-muted mb-3">Aktueller Kurs je Stück: {p != null ? formatCents(p) : 'unbekannt'}{h.as_of ? ` (Stand ${h.as_of.split('-').reverse().join('.')})` : ''}. Die Übersicht zeigt einen Hinweis, sobald eine Grenze erreicht ist.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hinweis unter"><AmountInput value={below} onChange={setBelow} ariaLabel="Kursgrenze unten" /></Field>
        <Field label="Hinweis über"><AmountInput value={above} onChange={setAbove} ariaLabel="Kursgrenze oben" /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
