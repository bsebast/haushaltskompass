import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, Paperclip, Split, ArrowLeftRight, Download, Upload, Landmark } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Empty, Dot } from '../components/ui';
import CategorySelect from '../components/CategorySelect';
import { useTxDialog } from '../components/Layout';
import { listAccounts, listTransactions, runningBalances, listCategories, descendantIds, setCategory } from '../db/repo';
import { formatDate, monthRange, currentMonth, addMonths, today } from '../lib/dates';
import { exportCsv } from '../lib/csvExport';
import { plannedTransactions, type PlannedTx } from '../db/plannedTx';
import BankImportDialog from '../components/BankImportDialog';
import BankFetchDialog from '../components/BankFetchDialog';
import { listCollections, addToCollection, removeFromCollection } from '../db/collections';

type Period = 'month' | 'last' | '3m' | 'year' | 'all';
const PERIODS: [Period, string][] = [['month', 'Dieser Monat'], ['last', 'Letzter Monat'], ['3m', '3 Monate'], ['year', 'Dieses Jahr'], ['all', 'Alles']];

type Plan = 'aus' | 'monat' | '3m' | '12m';
const PLANS: [Plan, string][] = [['aus', 'Ohne Prognose'], ['monat', 'Prognose bis Monatsende'], ['3m', 'Prognose 3 Monate'], ['12m', 'Prognose 12 Monate']];
function planUntil(p: Plan): string | null {
  if (p === 'aus') return null;
  return monthRange(addMonths(currentMonth(), p === 'monat' ? 0 : p === '3m' ? 2 : 11)).to;
}

function periodRange(p: Period): { from?: string; to?: string } {
  const m = currentMonth();
  if (p === 'month') return monthRange(m);
  if (p === 'last') return monthRange(addMonths(m, -1));
  if (p === '3m') return { from: monthRange(addMonths(m, -2)).from, to: monthRange(m).to };
  if (p === 'year') return { from: `${m.slice(0, 4)}-01-01`, to: `${m.slice(0, 4)}-12-31` };
  return {};
}

export default function Transactions() {
  const book = useBook();
  const [params, setParams] = useSearchParams();
  const accountId = params.get('konto');
  const categoryId = params.get('kategorie');
  const collectionId = params.get('sammlung');
  const period = (params.get('zeitraum') as Period) ?? 'all';
  const [search, setSearch] = useState(params.get('suche') ?? '');
  const [kind, setKind] = useState<'' | 'income' | 'expense' | 'transfer' | 'open'>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { openNew, openEdit } = useTxDialog();
  const [importing, setImporting] = useState(false);
  const [fetching, setFetching] = useState(false);

  const accounts = useQuery((b) => listAccounts(b, true));
  const cats = useQuery(listCategories);
  const collections = useQuery((b) => listCollections(b, false));
  const collection = collectionId ? collections.find((c) => c.id === collectionId) : undefined;
  const range = periodRange(period);
  const categoryIds = useMemo(() => (categoryId ? descendantIds(cats, categoryId) : undefined), [cats, categoryId]);
  const rows = useQuery(
    (b) => listTransactions(b, {
      accountId, ...range, search, categoryIds, collectionId,
      kind: kind && kind !== 'open' ? kind : undefined, uncategorized: kind === 'open',
    }),
    [accountId, range.from, range.to, search, categoryIds, kind, collectionId],
  );
  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  // Depots: der Kontostand ist ein Kurswert, ein laufender Saldo aus Buchungen wäre irreführend
  const running = useQuery((b) => (account && account.type !== 'depot' ? runningBalances(b, account.id) : null), [account?.id, account?.type]);
  const afterAnchor = useQuery(
    (b) => (account?.balance_date
      ? b.get<{ n: number }>('select count(*) n from transactions where account_id = ? and date > ?', [account.id, account.balance_date])?.n ?? 0
      : 0),
    [account?.id, account?.balance_date],
  );
  const plan = (params.get('prognose') as Plan) ?? '3m';
  const planTo = (() => {
    const u = planUntil(plan);
    if (!u) return null;
    if (range.to && range.to < u) return range.to < today() ? null : range.to;
    return u;
  })();
  const plannedAll = useQuery(
    (b) => (running && account && planTo ? plannedTransactions(b, account.id, planTo) : []),
    [account?.id, planTo, running === null],
  );
  const planned = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return plannedAll.filter((p) =>
      (!kind || (kind === 'income' ? p.amount > 0 && !p.transfer : kind === 'expense' ? p.amount < 0 && !p.transfer : kind === 'transfer' ? p.transfer : false))
      && (!categoryIds || (!!p.category_id && categoryIds.includes(p.category_id)))
      && terms.every((t) => `${p.payee ?? ''} ${p.label} ${p.category_name ?? ''}`.toLowerCase().includes(t)));
  }, [plannedAll, search, kind, categoryIds]);
  // Saldo der Prognose: vom heutigen Kontostand aus vorwärts (alle Prognose-Buchungen, auch die ausgefilterten)
  const plannedRun = useMemo(() => {
    const m = new Map<string, number>();
    let bal = account?.balance ?? 0;
    for (const p of plannedAll) { bal += p.amount; m.set(p.id, bal); }
    return { map: m, end: bal };
  }, [plannedAll, account?.balance]);
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <PageHeader title="Buchungen" subtitle={`${rows.length} Buchungen · Summe`} actions={
        <>
          <button className="btn-secondary" onClick={() => setFetching(true)} title="Umsätze per FinTS direkt von der Bank abrufen"><Landmark size={16} />Bankabruf</button>
          <button className="btn-secondary" onClick={() => setImporting(true)}><Upload size={16} />Import</button>
          <button className="btn-secondary" onClick={() => exportCsv(rows)} disabled={!rows.length}><Download size={16} />CSV</button>
          <button className="btn-secondary" onClick={() => openNew('transfer', accountId)}><ArrowLeftRight size={16} />Umbuchung</button>
        </>
      } />
      {importing && <BankImportDialog onClose={() => setImporting(false)} />}
      {fetching && <BankFetchDialog onClose={() => setFetching(false)} />}
      <div className="card p-3 mb-4 grid gap-2 md:grid-cols-[1fr_180px_180px_160px]">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
          <input className="input pl-9" placeholder="Suche: Empfänger, Zweck, Kategorie oder Betrag" aria-label="Buchungen durchsuchen"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" aria-label="Konto" value={accountId ?? ''} onChange={(e) => setParam('konto', e.target.value || null)}>
          <option value="">Alle Konten</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input" aria-label="Zeitraum" value={period} onChange={(e) => setParam('zeitraum', e.target.value === 'all' ? null : e.target.value)}>
          {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input" aria-label="Art" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="">Alle Arten</option>
          <option value="expense">Ausgaben</option>
          <option value="income">Einnahmen</option>
          <option value="transfer">Umbuchungen</option>
          <option value="open">Ohne Kategorie</option>
        </select>
        {collectionId && (
          <div className="md:col-span-4 text-sm flex items-center gap-2">
            Sammlung <strong>{collection?.name ?? '–'}</strong>
            <button className="text-accent hover:underline" onClick={() => setParam('sammlung', null)}>Filter entfernen</button>
          </div>
        )}
        {categoryId && (
          <div className="md:col-span-4 text-sm flex items-center gap-2">
            Gefiltert nach Kategorie <strong>{cats.find((c) => c.id === categoryId)?.name}</strong>
            <button className="text-accent hover:underline" onClick={() => setParam('kategorie', null)}>Filter entfernen</button>
          </div>
        )}
      </div>

      {account && (
        <div className="card p-4 mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-text-muted">Kontostand {account.bank ? `${account.bank} · ` : ''}{account.name}</div>
            <Money cents={account.balance} className="text-2xl font-semibold" />
          </div>
          {plannedAll.length > 0 && planTo && (
            <div>
              <div className="text-sm text-planned">Erwartet am {formatDate(planTo)}</div>
              <Money cents={plannedRun.end} colored={false} className="text-2xl font-semibold text-planned" />
            </div>
          )}
          <div className="text-xs text-text-muted text-right ml-auto">
            {running && (
              <select className="input mb-2 py-1 text-xs w-auto" aria-label="Prognose" value={plan}
                onChange={(e) => setParam('prognose', e.target.value === '3m' ? null : e.target.value)}>
                {PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
            <div>{account.balance_date
              ? <>Stand laut Bank am {formatDate(account.balance_date)}{afterAnchor > 0 ? ` + ${afterAnchor} ${afterAnchor === 1 ? 'Buchung' : 'Buchungen'} danach` : ''}</>
              : 'Anfangssaldo + alle Buchungen (kein Kontostand von der Bank erfasst)'}</div>
            {plannedAll.length > 0 && <div className="mt-1">Grau: {plannedAll.length} Prognose-Buchungen aus Verträgen und wiederkehrenden Zahlungen, nicht gebucht</div>}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="card p-3 mb-3 flex flex-wrap items-center gap-3 bg-accent-soft">
          <span className="text-sm font-medium">{selected.size} ausgewählt</span>
          <div className="w-64"><CategorySelect value={null} emptyLabel="Kategorie zuweisen …" ariaLabel="Kategorie zuweisen"
            onChange={(c) => { if (c) { setCategory(book, [...selected], c); setSelected(new Set()); } }} /></div>
          {collections.length > 0 ? (
            <select className="input w-56" aria-label="Zu Sammlung hinzufügen" value=""
              onChange={(e) => { if (e.target.value) { addToCollection(book, e.target.value, [...selected]); setSelected(new Set()); } }}>
              <option value="">Zu Sammlung hinzufügen …</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : <Link to="/sammlungen" className="text-sm text-accent hover:underline">Sammlung anlegen</Link>}
          {collectionId && <button className="btn-secondary" onClick={() => { removeFromCollection(book, collectionId, [...selected]); setSelected(new Set()); }}>Aus Sammlung entfernen</button>}
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
        </div>
      )}

      <div className="card overflow-hidden">
        {rows.length === 0 && planned.length === 0 ? (
          <Empty title="Keine Buchungen gefunden" text={search || accountId || categoryId || collectionId || period !== 'all' || kind ? 'Passe die Filter an oder lege eine neue Buchung an.' : 'Lege deine erste Buchung an.'}
            action={<button className="btn-primary" onClick={() => openNew(undefined, accountId)}>Neue Buchung</button>} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-text-muted text-xs">
              <tr>
                <th className="w-8 px-3 py-2"><span className="sr-only">Auswahl</span></th>
                <th className="text-left px-2 py-2 font-medium w-24">Datum</th>
                <th className="text-left px-2 py-2 font-medium">Empfänger / Zweck</th>
                <th className="text-left px-2 py-2 font-medium hidden md:table-cell">Kategorie</th>
                {!accountId && <th className="text-left px-2 py-2 font-medium hidden lg:table-cell">Konto</th>}
                <th className="text-right px-3 py-2 font-medium">Betrag</th>
                {running && <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Saldo</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...planned].reverse().map((p) => <PlannedRow key={p.id} p={p} saldo={plannedRun.map.get(p.id)!} showAccount={!accountId} />)}
              {rows.slice(0, 1000).map((t) => (
                <tr key={t.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => openEdit(t)}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {!t.transfer_id && <input type="checkbox" aria-label="Buchung auswählen" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-text-muted whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="px-2 py-2 max-w-0 w-full">
                    <div className="truncate font-medium">{t.payee || <span className="text-text-muted">–</span>}</div>
                    {(t.purpose || t.note) && <div className="truncate text-xs text-text-muted">{[t.purpose, t.note].filter(Boolean).join(' · ')}</div>}
                    <div className="md:hidden text-xs text-text-muted mt-0.5"><CatLabel t={t} /></div>
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell whitespace-nowrap"><CatLabel t={t} /></td>
                  {!accountId && <td className="px-2 py-2 hidden lg:table-cell text-text-muted whitespace-nowrap">{t.account_name}</td>}
                  <td className="px-3 py-2 text-right font-medium">
                    <Money cents={t.amount} colored={!t.transfer_id} />
                    {running?.has(t.id) && <div className="sm:hidden text-xs text-text-muted font-normal"><Money cents={running.get(t.id)!} colored={false} /></div>}
                  </td>
                  {running && <td className="px-3 py-2 text-right hidden sm:table-cell text-text-muted">{running.has(t.id) && <Money cents={running.get(t.id)!} colored={false} />}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2">
                <td colSpan={accountId ? 4 : 5} className="px-3 py-2 text-sm font-medium">Summe der angezeigten Buchungen{planned.length ? ' (ohne Prognose)' : ''}{rows.length > 1000 ? ' (Liste zeigt die ersten 1.000)' : ''}</td>
                <td className="px-3 py-2 text-right font-semibold"><Money cents={sum} /></td>
                {running && <td className="hidden sm:table-cell" />}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

function PlannedRow({ p, saldo, showAccount }: { p: PlannedTx; saldo: number; showAccount: boolean }) {
  return (
    <tr className="bg-planned-bg text-planned" title={`Prognose, noch nicht gebucht · ${p.label}`}>
      <td className="px-3 py-2"><span className="sr-only">Prognose</span></td>
      <td className="px-2 py-2 tabular-nums whitespace-nowrap">{formatDate(p.date)}</td>
      <td className="px-2 py-2 max-w-0 w-full">
        <div className="truncate italic">{p.payee || '–'}</div>
        <div className="truncate text-xs">Prognose · {p.label}</div>
      </td>
      <td className="px-2 py-2 hidden md:table-cell whitespace-nowrap">
        {p.transfer ? <span className="inline-flex items-center gap-1.5"><ArrowLeftRight size={14} aria-hidden /> Umbuchung</span>
          : p.category_name ? <span className="inline-flex items-center gap-1.5 opacity-80"><Dot color={p.category_color} />{p.category_name}</span> : '–'}
      </td>
      {showAccount && <td className="hidden lg:table-cell" />}
      <td className="px-3 py-2 text-right italic">
        <Money cents={p.amount} colored={false} />
        <div className="sm:hidden text-xs"><Money cents={saldo} colored={false} /></div>
      </td>
      <td className="px-3 py-2 text-right hidden sm:table-cell"><Money cents={saldo} colored={false} /></td>
    </tr>
  );
}

function CatLabel({ t }: { t: { transfer_id: string | null; split_count: number; category_name: string | null; category_color: string | null; doc_count: number } }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {t.transfer_id ? <><ArrowLeftRight size={14} aria-hidden /> Umbuchung</>
        : t.split_count ? <><Split size={14} aria-hidden /> Aufgeteilt ({t.split_count})</>
        : t.category_name ? <><Dot color={t.category_color} />{t.category_name}</>
        : <span className="text-warning">Ohne Kategorie</span>}
      {t.doc_count > 0 && <Paperclip size={14} aria-label="Beleg vorhanden" />}
    </span>
  );
}
