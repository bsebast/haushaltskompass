import { useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useBook, useQuery } from '../state';
import { PageHeader, Empty, ErrorNote, Dot } from '../components/ui';
import CategorySelect from '../components/CategorySelect';
import { listRules, saveRule, deleteRule, applyRulesToUncategorized, listCategories, listTransactions } from '../db/repo';
import { ruleMatches } from '../db/rules';
import type { Rule } from '../db/types';

const FIELDS: Record<Rule['field'], string> = { any: 'Empfänger oder Zweck', payee: 'Empfänger', purpose: 'Verwendungszweck' };
const OPS: Record<Rule['op'], string> = { contains: 'enthält', equals: 'ist genau', starts_with: 'beginnt mit', regex: 'passt zu Muster' };

export default function Rules() {
  const book = useBook();
  const rules = useQuery(listRules);
  const cats = useQuery(listCategories);
  const open = useQuery((b) => listTransactions(b, { uncategorized: true }));
  const [field, setField] = useState<Rule['field']>('any');
  const [op, setOp] = useState<Rule['op']>('contains');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const preview = value.trim() ? open.filter((t) => ruleMatches({ field, op, value }, t)).length : 0;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!category) throw new Error('Bitte eine Kategorie wählen.');
      saveRule(book, { field, op, value, category_id: category });
      setValue('');
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <>
      <PageHeader title="Regeln" subtitle="Neue und importierte Buchungen ohne Kategorie werden automatisch nach diesen Regeln zugeordnet." actions={
        <button className="btn-secondary" disabled={!open.length} onClick={() => setInfo(`${applyRulesToUncategorized(book)} Buchungen zugeordnet.`)}>
          <Wand2 size={16} />Auf {open.length} offene Buchungen anwenden
        </button>
      } />
      {info && <p className="text-sm text-success mb-3" role="status">{info}</p>}
      <form onSubmit={add} className="card p-3 mb-4 grid gap-2 md:grid-cols-[180px_150px_1fr_220px_auto] items-start">
        <select className="input" aria-label="Feld" value={field} onChange={(e) => setField(e.target.value as Rule['field'])}>
          {Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Bedingung" value={op} onChange={(e) => setOp(e.target.value as Rule['op'])}>
          {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div>
          <input className="input" aria-label="Suchbegriff" placeholder="z. B. rewe" value={value} onChange={(e) => setValue(e.target.value)} />
          {value.trim() && <span className="text-xs text-text-muted">trifft {preview} offene Buchungen</span>}
        </div>
        <CategorySelect ariaLabel="Kategorie" value={category} onChange={setCategory} allowEmpty emptyLabel="→ Kategorie wählen" />
        <button className="btn-primary" type="submit"><Plus size={16} />Regel</button>
        <div className="md:col-span-5"><ErrorNote error={error} /></div>
      </form>
      <div className="card divide-y divide-border">
        {rules.length === 0 && <Empty title="Noch keine Regeln" text="Beispiel: Empfänger enthält „rewe“ → Lebensmittel › Supermarkt." />}
        {rules.map((r) => {
          const c = cats.find((x) => x.id === r.category_id);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <input type="checkbox" aria-label="Regel aktiv" checked={!!r.enabled} onChange={(e) => saveRule(book, { ...r, enabled: e.target.checked ? 1 : 0 })} />
              <span className="text-text-muted">{FIELDS[r.field]} {OPS[r.op]}</span>
              <code className="bg-surface-2 px-1.5 rounded">{r.value}</code>
              <span className="text-text-muted">→</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={c?.color} />{c?.name ?? '?'}</span>
              <button className="btn-ghost w-8 h-8 px-0 ml-auto" aria-label="Regel löschen" onClick={() => deleteRule(book, r.id)}><Trash2 size={15} /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}
