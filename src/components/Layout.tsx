import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Wallet, ListOrdered, Tags, Wand2, Target, BarChart3, Settings, Plus, Menu, Compass, FileText } from 'lucide-react';
import { useBookCtx } from '../state';
import TxDialog, { type TxMode } from './TxDialog';
import type { Transaction } from '../db/types';

interface TxCtx { openNew: (mode?: TxMode, accountId?: string | null) => void; openEdit: (tx: Transaction) => void }
const TxContext = createContext<TxCtx>({ openNew: () => {}, openEdit: () => {} });
export const useTxDialog = () => useContext(TxContext);

const NAV = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/buchungen', label: 'Buchungen', icon: ListOrdered },
  { to: '/konten', label: 'Konten', icon: Wallet },
  { to: '/vertraege', label: 'Verträge', icon: FileText },
  { to: '/budgets', label: 'Budgets', icon: Target },
  { to: '/auswertungen', label: 'Auswertungen', icon: BarChart3 },
  { to: '/kategorien', label: 'Kategorien', icon: Tags },
  { to: '/regeln', label: 'Regeln', icon: Wand2 },
  { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
];

export default function Layout() {
  const { book, saving } = useBookCtx();
  const [dialog, setDialog] = useState<{ mode?: TxMode; account?: string | null; edit?: Transaction } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const openNew = useCallback((mode?: TxMode, account?: string | null) => setDialog({ mode, account }), []);
  const openEdit = useCallback((edit: Transaction) => setDialog({ edit }), []);

  // Schnellerfassung: Taste "n" außerhalb von Eingabefeldern
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.key === 'n') { e.preventDefault(); openNew(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, openNew]);

  const name = book?.meta('book_name') ?? 'Haushaltsbuch';

  return (
    <TxContext.Provider value={{ openNew, openEdit }}>
      <div className="min-h-full lg:grid lg:grid-cols-[232px_1fr]">
        <aside className={`${navOpen ? 'block' : 'hidden'} lg:block fixed lg:sticky top-0 z-40 lg:z-auto h-screen w-[232px] bg-surface border-r border-border`}>
          <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
            <Compass className="text-accent" size={22} aria-hidden />
            <span className="font-semibold">Haushaltskompass</span>
          </div>
          <nav className="p-2 space-y-0.5" aria-label="Hauptnavigation">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setNavOpen(false)}
                className={({ isActive }) => `flex items-center gap-3 px-3 h-9 rounded-md text-sm ${isActive ? 'bg-accent-soft text-accent font-medium' : 'text-text hover:bg-surface-2'}`}>
                <Icon size={18} aria-hidden />{label}
              </NavLink>
            ))}
          </nav>
          <div className="absolute bottom-0 inset-x-0 p-4 text-xs text-text-muted border-t border-border">
            <div className="truncate" title={name}>{name}</div>
            <div>{saving ? 'Wird gespeichert …' : 'Lokal gespeichert'}</div>
          </div>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-text/20 lg:hidden" onClick={() => setNavOpen(false)} />}
        <div className="min-w-0">
          <header className="sticky top-0 z-20 h-14 bg-bg/90 backdrop-blur border-b border-border flex items-center gap-3 px-4 lg:px-8">
            <button className="btn-ghost w-9 px-0 lg:hidden" aria-label="Menü" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
            <span className="lg:hidden font-semibold">Haushaltskompass</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden md:inline text-xs text-text-muted">Taste <kbd className="px-1 border border-border rounded">N</kbd> für neue Buchung</span>
              <button className="btn-primary" onClick={() => openNew()}><Plus size={16} />Neue Buchung</button>
            </div>
          </header>
          <main className="px-4 lg:px-8 py-6 max-w-[1280px]">
            <Outlet />
          </main>
        </div>
      </div>
      {dialog && <TxDialog onClose={() => setDialog(null)} edit={dialog.edit} initialMode={dialog.mode} initialAccount={dialog.account} />}
    </TxContext.Provider>
  );
}
