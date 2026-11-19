import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { formatCents } from '../lib/money';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Money({ cents, colored = true, className = '' }: { cents: number; colored?: boolean; className?: string }) {
  const cls = !colored ? 'tabular-nums' : cents < 0 ? 'amount-neg' : cents > 0 ? 'amount-pos' : 'tabular-nums';
  return <span className={`${cls} whitespace-nowrap ${className}`}>{formatCents(cents)}</span>;
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <p className="font-medium">{title}</p>
      {text && <p className="text-sm text-text-muted mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-text/30 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`bg-surface w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} sm:rounded-lg shadow-xl max-h-full sm:max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button data-close className="btn-ghost w-9 px-0" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger mt-1">{error}</span> : hint ? <span className="block text-xs text-text-muted mt-1">{hint}</span> : null}
    </label>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="text-sm text-danger bg-danger/5 border border-danger/30 rounded-md px-3 py-2 mt-3">{error}</p>;
}

export function Bar({ ratio, state }: { ratio: number; state: 'ok' | 'warn' | 'over' }) {
  const color = state === 'over' ? 'bg-danger' : state === 'warn' ? 'bg-warning' : 'bg-accent';
  return (
    <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}

export function Dot({ color }: { color?: string | null }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color ?? '#8a8478' }} />;
}
