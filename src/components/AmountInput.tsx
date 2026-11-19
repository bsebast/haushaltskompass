import { useEffect, useState } from 'react';
import { parseAmount, centsToInput } from '../lib/money';

/** Betragseingabe im deutschen Format; liefert positive Cent oder null. */
export default function AmountInput({ value, onChange, id, autoFocus, ariaLabel }: {
  value: number | null; onChange: (cents: number | null) => void; id?: string; autoFocus?: boolean; ariaLabel?: string;
}) {
  const [text, setText] = useState(value != null ? centsToInput(value) : '');
  useEffect(() => {
    const parsed = parseAmount(text);
    if (value == null && text === '') return;
    if (parsed == null || Math.abs(parsed) !== value) setText(value != null ? centsToInput(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <input
        id={id}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        inputMode="decimal"
        className="input pr-8 text-right tabular-nums"
        placeholder="0,00"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parseAmount(e.target.value);
          onChange(p == null ? null : Math.abs(p));
        }}
        onBlur={() => value != null && setText(centsToInput(value))}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">€</span>
    </div>
  );
}
