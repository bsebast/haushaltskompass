import { Fragment, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Money, Field, ErrorNote, Empty } from '../components/ui';
import AmountInput from '../components/AmountInput';
import { ForecastChart, SERIES } from '../components/charts';
import { listAccounts } from '../db/repo';
import {
  loadForecast, saveForecast, forecastBase, computeForecast, summarize, newScenario, newAdjustment, dueIn, LIQUID_TYPES,
  type ForecastConfig, type Scenario, type Adjustment, type AdjustmentKind,
} from '../db/forecast';
import { ACCOUNT_TYPES } from '../db/types';
import { addMonths, currentMonth, monthLabel } from '../lib/dates';
import { formatCents } from '../lib/money';
import { download } from '../lib/csvExport';

const KIND_LABEL: Record<AdjustmentKind, string> = { once: 'Einmalig', monthly: 'Monatlich', percent: 'Prozentual' };

function describe(a: Adjustment): string {
  const range = a.kind === 'once' ? monthLabel(a.from, true) : `ab ${monthLabel(a.from, true)}${a.to ? ` bis ${monthLabel(a.to, true)}` : ''}`;
  if (a.kind === 'percent') return `${a.target === 'income' ? 'Einnahmen' : 'Ausgaben'} ${(a.pct ?? 0) > 0 ? '+' : ''}${String(a.pct ?? 0).replace('.', ',')} % ${range}`;
  return `${formatCents(a.amount ?? 0)} ${a.kind === 'monthly' ? 'im Monat ' : ''}${range}`;
}

export default function Forecast() {
  const book = useBook();
  const cfg = useQuery(loadForecast);
  const accounts = useQuery((b) => listAccounts(b).filter((a) => !a.external));
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const update = (c: ForecastConfig) => saveForecast(book, c);
  const s = cfg.settings;

  const base = useQuery((b) => forecastBase(b, s), [JSON.stringify(s)]);
  const runs = useMemo(() => {
    const list: { key: string; name: string; color: string; rows: ReturnType<typeof computeForecast> }[] = [
      { key: 'basis', name: 'Basis', color: SERIES[0], rows: computeForecast(base, null) },
    ];
    cfg.scenarios.forEach((sc, i) => list.push({ key: sc.id, name: sc.name, color: SERIES[(i + 1) % SERIES.length], rows: computeForecast(base, sc) }));
    return list;
  }, [base, cfg.scenarios]);
  const chart = base.months.map((month, i) => {
    const row: Record<string, number | string> = { month };
    for (const r of runs) row[r.key] = r.rows[i].balance;
    return row;
  });
  const sum = summarize(runs[0].rows, s.floor);
  const scope = new Set(base.accountIds);
  const scenario = cfg.scenarios.find((x) => x.id === active) ?? null;

  const setSettings = (patch: Partial<typeof s>) => update({ ...cfg, settings: { ...s, ...patch } });
  const toggleAccount = (id: string) => {
    const ids = new Set(base.accountIds);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    const liquid = accounts.filter((a) => LIQUID_TYPES.includes(a.type)).map((a) => a.id);
    const same = ids.size === liquid.length && liquid.every((x) => ids.has(x));
    setSettings({ accountIds: same ? null : [...ids] });
  };
  const addScenario = () => {
    const sc = newScenario(`Szenario ${cfg.scenarios.length + 1}`);
    update({ ...cfg, scenarios: [...cfg.scenarios, sc] });
    setActive(sc.id);
  };
  const saveScenario = (sc: Scenario) => update({ ...cfg, scenarios: cfg.scenarios.map((x) => (x.id === sc.id ? sc : x)) });
  const removeScenario = (id: string) => {
    update({ ...cfg, scenarios: cfg.scenarios.filter((x) => x.id !== id) });
    if (active === id) setActive(null);
  };

  const exportCsv = () => {
    const head = ['Monat', 'Einnahmen', 'Ausgaben', 'davon Verträge', 'Kontostand Basis', ...runs.slice(1).map((r) => `Kontostand ${r.name}`)];
    const e = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    const rows = base.months.map((m, i) => [monthLabel(m, true), e(runs[0].rows[i].income), e(runs[0].rows[i].expense), e(runs[0].rows[i].contracts), ...runs.map((r) => e(r.rows[i].balance))].join(';'));
    download(`prognose-${currentMonth()}.csv`, '﻿' + [head.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  };

  if (!accounts.length) return <><PageHeader title="Prognose" /><div className="card"><Empty title="Noch keine Konten" /></div></>;

  return (
    <>
      <PageHeader title="Prognose" subtitle="So entwickelt sich dein verfügbares Geld, wenn alles so weiterläuft wie bisher, und mit eigenen Annahmen."
        actions={<button className="btn-secondary" onClick={exportCsv}>CSV exportieren</button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card p-5"><div className="text-xs text-text-muted">Heute</div><div className="text-xl font-semibold mt-1"><Money cents={base.start} /></div>
          <div className="text-xs text-text-muted mt-0.5">{base.accountIds.length} Konten</div></div>
        <div className="card p-5"><div className="text-xs text-text-muted">{monthLabel(base.months[base.months.length - 1], true)}</div><div className="text-xl font-semibold mt-1"><Money cents={sum.end} /></div>
          <div className="text-xs text-text-muted mt-0.5">Basis, {s.months} Monate</div></div>
        <div className="card p-5"><div className="text-xs text-text-muted">Tiefster Stand</div><div className="text-xl font-semibold mt-1"><Money cents={sum.low} /></div>
          <div className="text-xs text-text-muted mt-0.5">{monthLabel(sum.lowMonth, true)}</div></div>
        <div className="card p-5"><div className="text-xs text-text-muted">Ø Überschuss im Monat</div><div className="text-xl font-semibold mt-1"><Money cents={base.avgIncome + base.avgExpense} /></div>
          <div className="text-xs text-text-muted mt-0.5">aus {base.historyMonths.length} Monaten</div></div>
      </div>
      {sum.belowFloor && (
        <p role="alert" className="text-sm mb-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
          Im {monthLabel(sum.belowFloor, true)} fällt der Stand voraussichtlich unter die Warngrenze von {formatCents(s.floor ?? 0)}.
        </p>
      )}

      <section className="card p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Voraussichtlicher Kontostand am Monatsende</h2>
        <ForecastChart data={chart} series={runs.map(({ key, name, color }) => ({ key, name, color }))} floor={s.floor} onPick={(m) => setOpen(m)} />
        <p className="text-xs text-text-muted mt-2">
          Grundlage: Ø Einnahmen {formatCents(base.avgIncome)} und Ø Ausgaben {formatCents(-base.avgExpense)} der letzten {base.historyMonths.length} Monate.
          Verträge erscheinen im Monat, in dem sie fällig sind. Umbuchungen zwischen den gewählten Konten zählen nicht.
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-3 mb-4">
        <section className="card p-5">
          <h2 className="text-sm font-semibold mb-3">Einstellungen</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vorschau">
              <select className="input" value={s.months} onChange={(e) => setSettings({ months: Number(e.target.value) })}>
                {[6, 12, 24, 36, 60].map((n) => <option key={n} value={n}>{n} Monate</option>)}
              </select>
            </Field>
            <Field label="Durchschnitt aus">
              <select className="input" value={s.history} onChange={(e) => setSettings({ history: Number(e.target.value) })}>
                {[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} Monaten</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Warngrenze (optional)" hint="Hinweis, wenn der Stand darunter fällt">
              <AmountInput value={s.floor} onChange={(v) => setSettings({ floor: v })} ariaLabel="Warngrenze" />
            </Field>
            <Field label="Einmalige Ausgaben ab" hint="zählen nicht zum Durchschnitt, leer = alle zählen">
              <AmountInput value={s.oneOff} onChange={(v) => setSettings({ oneOff: v || null })} ariaLabel="Einmalige Ausgaben ab" />
            </Field>
          </div>
          {base.oneOffs.length > 0 && (
            <div className="mt-2 text-xs text-text-muted">
              Herausgerechnet: {base.oneOffs.map((t) => `${t.payee ?? 'ohne Empfänger'} ${formatCents(t.amount)} (${t.date.split('-').reverse().join('.')})`).join(' · ')}.
              {' '}Kommt so etwas wieder, trag es als Szenario ein.
            </div>
          )}
          <fieldset className="mt-3">
            <legend className="label">Konten</legend>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {accounts.map((a) => (
                <li key={a.id}><label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={scope.has(a.id)} onChange={() => toggleAccount(a.id)} />
                  <span className="flex-1 min-w-0 truncate">{a.name} <span className="text-xs text-text-muted">{ACCOUNT_TYPES[a.type]}{a.owner ? ` · ${a.owner}` : ''}</span></span>
                  <Money cents={a.balance} className="shrink-0" />
                </label></li>
              ))}
            </ul>
            {s.accountIds && <button className="text-xs text-accent hover:underline mt-2" onClick={() => setSettings({ accountIds: null })}>Zurück auf alle liquiden Konten</button>}
          </fieldset>
        </section>

        <section className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Szenarien</h2>
            <button className="btn-secondary h-8" onClick={addScenario}><Plus size={14} /> Szenario</button>
          </div>
          {cfg.scenarios.length === 0 ? (
            <p className="text-sm text-text-muted">Mit Szenarien probierst du Annahmen aus, etwa eine Gehaltserhöhung, einen Autokauf oder eine neue Miete, und vergleichst sie mit der Basis.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Szenario">
                {cfg.scenarios.map((sc, i) => {
                  const r = runs[i + 1];
                  return (
                    <button key={sc.id} role="tab" aria-selected={active === sc.id} onClick={() => setActive(active === sc.id ? null : sc.id)}
                      className={`px-3 h-8 rounded-full text-sm border inline-flex items-center gap-2 ${active === sc.id ? 'bg-accent text-on-accent border-accent' : 'border-border bg-surface hover:bg-surface-2'}`}>
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{sc.name}
                      <span className="text-xs opacity-80">{formatCents(r.rows[r.rows.length - 1].balance - sum.end)}</span>
                    </button>
                  );
                })}
              </div>
              {scenario ? <ScenarioEditor key={scenario.id} scenario={scenario} onSave={saveScenario} onRemove={() => removeScenario(scenario.id)} />
                : <p className="text-sm text-text-muted">Wähle ein Szenario, um seine Annahmen zu bearbeiten. Die Zahl zeigt den Unterschied zur Basis am Ende der Vorschau.</p>}
            </>
          )}
        </section>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-surface-2 text-xs text-text-muted">
            <tr><th className="text-left px-4 py-2 font-medium">Monat</th><th className="text-right px-2 font-medium">Einnahmen</th><th className="text-right px-2 font-medium">Ausgaben</th>
              <th className="text-right px-2 font-medium">davon Verträge*</th><th className="text-right px-2 font-medium">Kontostand</th>
              {runs.slice(1).map((r) => <th key={r.key} className="text-right px-4 font-medium">{r.name}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {base.months.map((m, i) => {
              const r = runs[0].rows[i];
              const due = base.contracts.filter((c) => c.interval !== 'monthly' && dueIn(c, m));
              return (
                <Fragment key={m}>
                  <tr className={`cursor-pointer hover:bg-surface-2 ${s.floor != null && r.balance < s.floor ? 'bg-danger/5' : ''}`} onClick={() => setOpen(open === m ? null : m)}>
                    <td className="px-4 py-1.5">{monthLabel(m, true)}{i === 0 && <span className="text-xs text-text-muted"> (Rest)</span>}</td>
                    <td className="text-right px-2"><Money cents={r.income} /></td>
                    <td className="text-right px-2"><Money cents={r.expense} /></td>
                    <td className="text-right px-2 text-text-muted">{r.contracts ? <Money cents={r.contracts} colored={false} /> : '–'}</td>
                    <td className="text-right px-2 font-medium"><Money cents={r.balance} /></td>
                    {runs.slice(1).map((x) => <td key={x.key} className="text-right px-4"><Money cents={x.rows[i].balance} /></td>)}
                  </tr>
                  {open === m && (
                    <tr className="bg-surface-2/50"><td colSpan={5 + runs.length - 1} className="px-4 py-2 text-xs">
                      {due.length ? <>Nicht monatliche Verträge in diesem Monat: {due.map((c) => `${c.name} ${formatCents(c.amount)}`).join(' · ')}</> : 'Keine nicht monatlichen Verträge in diesem Monat.'}
                      {runs.slice(1).filter((x) => x.rows[i].extra).map((x) => <div key={x.key}>{x.name}: Annahmen {formatCents(x.rows[i].extra)}</div>)}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-text-muted">* Abweichung vom Durchschnitt: Jahres- und Quartalsbeiträge im Fälligkeitsmonat, neue und auslaufende Verträge. Zeile anklicken für Einzelheiten.</p>
      </section>
    </>
  );
}

function ScenarioEditor({ scenario, onSave, onRemove }: { scenario: Scenario; onSave: (s: Scenario) => void; onRemove: () => void }) {
  const next = addMonths(currentMonth(), 1);
  const [name, setName] = useState(scenario.name);
  const [kind, setKind] = useState<AdjustmentKind>('once');
  const [label, setLabel] = useState('');
  const [sign, setSign] = useState<-1 | 1>(-1);
  const [amount, setAmount] = useState<number | null>(null);
  const [pct, setPct] = useState('');
  const [target, setTarget] = useState<'income' | 'expense'>('income');
  const [from, setFrom] = useState(next);
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setError(null);
    if (!/^\d{4}-\d{2}$/.test(from)) return setError('Bitte einen Monat wählen.');
    if (to && to < from) return setError('Der letzte Monat liegt vor dem ersten.');
    let a: Adjustment;
    if (kind === 'percent') {
      const p = Number(pct.replace(',', '.'));
      if (!pct.trim() || Number.isNaN(p)) return setError('Bitte einen Prozentwert eingeben, z. B. 3 oder -10.');
      a = newAdjustment({ label: label.trim() || `${target === 'income' ? 'Einnahmen' : 'Ausgaben'} ${p > 0 ? '+' : ''}${p} %`, kind, pct: p, target, from, to: to || null });
    } else {
      if (!amount) return setError('Bitte einen Betrag eingeben.');
      a = newAdjustment({ label: label.trim() || (sign < 0 ? 'Ausgabe' : 'Einnahme'), kind, amount: sign * amount, from, to: kind === 'monthly' ? to || null : null });
    }
    onSave({ ...scenario, adjustments: [...scenario.adjustments, a] });
    setLabel(''); setAmount(null); setPct('');
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <Field label="Name"><input className="input w-64" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== scenario.name && onSave({ ...scenario, name: name.trim() })} /></Field>
        <button className="btn-ghost text-danger h-9" onClick={() => window.confirm(`Szenario „${scenario.name}“ löschen?`) && onRemove()}><Trash2 size={14} /> Löschen</button>
      </div>
      {scenario.adjustments.length > 0 ? (
        <ul className="divide-y divide-border border border-border rounded-md mb-3">
          {scenario.adjustments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="text-xs text-text-muted w-20">{KIND_LABEL[a.kind]}</span>
              <span className="flex-1 truncate font-medium">{a.label}</span>
              <span className="text-text-muted text-xs">{describe(a)}</span>
              <button className="text-text-muted hover:text-danger" aria-label={`${a.label} entfernen`} onClick={() => onSave({ ...scenario, adjustments: scenario.adjustments.filter((x) => x.id !== a.id) })}><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted mb-3">Noch keine Annahmen. Ohne Annahmen entspricht das Szenario der Basis.</p>}
      <form className="grid sm:grid-cols-6 gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="Art"><select className="input" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
          {(Object.keys(KIND_LABEL) as AdjustmentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select></Field>
        <div className="sm:col-span-2"><Field label="Bezeichnung"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'percent' ? 'z. B. Gehaltserhöhung' : 'z. B. Neues Auto'} /></Field></div>
        {kind === 'percent' ? (
          <>
            <Field label="Bezieht sich auf"><select className="input" value={target} onChange={(e) => setTarget(e.target.value as 'income' | 'expense')}>
              <option value="income">Einnahmen</option><option value="expense">Ausgaben</option></select></Field>
            <Field label="Prozent"><input className="input text-right" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="z. B. 3" /></Field>
          </>
        ) : (
          <>
            <Field label="Richtung"><select className="input" value={sign} onChange={(e) => setSign(Number(e.target.value) as -1 | 1)}>
              <option value={-1}>Ausgabe</option><option value={1}>Einnahme</option></select></Field>
            <Field label="Betrag"><AmountInput value={amount} onChange={setAmount} ariaLabel="Betrag" /></Field>
          </>
        )}
        <Field label={kind === 'once' ? 'Monat' : 'Ab'}><input type="month" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        {kind !== 'once' && <Field label="Bis (optional)"><input type="month" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
        <div><button type="submit" className="btn-primary w-full"><Plus size={14} /> Hinzufügen</button></div>
      </form>
      <ErrorNote error={error} />
    </div>
  );
}
