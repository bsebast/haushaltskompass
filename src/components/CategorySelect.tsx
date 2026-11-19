import { useMemo } from 'react';
import { useQuery } from '../state';
import { categoryTree, flattenTree, listCategories } from '../db/repo';

export default function CategorySelect({ value, onChange, kind, allowEmpty = true, emptyLabel = 'Ohne Kategorie', id, ariaLabel }: {
  value: string | null; onChange: (id: string | null) => void; kind?: 'income' | 'expense'; allowEmpty?: boolean;
  emptyLabel?: string; id?: string; ariaLabel?: string;
}) {
  const cats = useQuery(listCategories);
  const groups = useMemo(() => {
    const tree = categoryTree(cats);
    const kinds: ('expense' | 'income')[] = kind ? [kind] : ['expense', 'income'];
    return kinds.map((k) => ({ k, items: flattenTree(tree.filter((n) => n.kind === k)) }));
  }, [cats, kind]);
  return (
    <select id={id} aria-label={ariaLabel} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {groups.map((g) => (
        <optgroup key={g.k} label={g.k === 'expense' ? 'Ausgaben' : 'Einnahmen'}>
          {g.items.map((c) => (
            <option key={c.id} value={c.id}>
              {' '.repeat(c.path.split(' › ').length - 1)}{c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
