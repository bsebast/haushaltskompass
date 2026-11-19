/** Beträge werden intern als ganze Cent (Integer) geführt. */

const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatCents(cents: number, currency = 'EUR'): string {
  if (currency !== 'EUR') {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
  }
  return fmt.format(cents / 100);
}

/**
 * Liest deutsche und internationale Schreibweisen: "12,5", "12.50", "1.234,56", "1,234.56", "-3", "−4,20 €".
 * Gibt null zurück, wenn die Eingabe kein Betrag ist.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[€\s ]|EUR/gi, '').replace(/−/g, '-');
  if (!s) return null;
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); } else if (s.startsWith('+')) { s = s.slice(1); }
  if (s.endsWith('-')) { sign = -1; s = s.slice(0, -1); }
  if (!/^[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let frac = '';
  const decIdx = Math.max(lastComma, lastDot);
  if (decIdx === -1) {
    intPart = s;
  } else {
    const sep = s[decIdx];
    const other = sep === ',' ? '.' : ',';
    const after = s.slice(decIdx + 1);
    const onlyOneOfSep = s.indexOf(sep) === decIdx;
    // "1.234" (ein Punkt, genau 3 Nachkommastellen, kein Komma) ist ein Tausenderpunkt
    const looksLikeThousands = sep === '.' && after.length === 3 && !s.includes(',');
    if (!onlyOneOfSep || looksLikeThousands) {
      intPart = s.split(sep).join('');
      if (intPart.includes(other)) return null;
    } else {
      intPart = s.slice(0, decIdx).split(other).join('');
      frac = after;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart + frac).length === 0) return null;
  if (frac.length > 2) {
    // auf Cent runden
    const n = Math.round(Number(`${intPart || '0'}.${frac}`) * 100);
    return sign * n;
  }
  const cents = Number(intPart || '0') * 100 + Number((frac + '00').slice(0, 2));
  return sign * cents;
}

export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}
