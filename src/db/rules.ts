import type { Rule } from './types';

export interface RuleInput {
  payee?: string | null;
  purpose?: string | null;
}

function norm(s: string) {
  return s.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
}

export function ruleMatches(rule: Pick<Rule, 'field' | 'op' | 'value'>, tx: RuleInput): boolean {
  const fields = rule.field === 'any' ? [tx.payee, tx.purpose] : [tx[rule.field]];
  return fields.some((f) => {
    if (!f) return false;
    if (rule.op === 'regex') {
      try {
        return new RegExp(rule.value, 'i').test(f);
      } catch {
        return false;
      }
    }
    const a = norm(f);
    const b = norm(rule.value);
    if (!b) return false;
    if (rule.op === 'equals') return a === b;
    if (rule.op === 'starts_with') return a.startsWith(b);
    return a.includes(b);
  });
}

/** Erste passende aktive Regel nach Priorität (kleiner = zuerst). */
export function findCategory(rules: Rule[], tx: RuleInput): string | null {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  return sorted.find((r) => ruleMatches(r, tx))?.category_id ?? null;
}
