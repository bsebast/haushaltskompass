import { DrillProvider } from './DrillDown';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { LayoutDashboard, Wallet, ListOrdered, Tags, Wand2, Target, BarChart3, Settings, Plus, Menu, Compass, FileText, Landmark, Umbrella, TrendingUp, Package, PiggyBank, FolderHeart, Sun, Moon, X } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useBookCtx } from '../state';
import TxDialog, { type TxMode } from './TxDialog';
import type { Transaction } from '../db/types';

interface TxCtx { openNew: (mode?: TxMode, accountId?: string | null) => void; openEdit: (tx: Transaction) => void }
const TxContext = createContext<TxCtx>({ openNew: () => {}, openEdit: () => {} });
export const useTxDialog = () => useContext(TxContext);

const NAV: { title?: string; items: { to: string; label: string; icon: typeof Compass; end?: boolean }[] }[] = [
  { items: [
    { to: '/', label: 'Übersicht', icon: LayoutDashboard, end: true },
    { to: '/buchungen', label: 'Buchungen', icon: ListOrdered },
    { to: '/konten', label: 'Konten', icon: Wallet },
  ] },
  { title: 'Besitz & Verträge', items: [
    { to: '/vertraege', label: 'Verträge', icon: FileText },
    { to: '/vermoegen', label: 'Vermögen', icon: Landmark },
    { to: '/vorsorge', label: 'Vorsorge', icon: Umbrella },
    { to: '/inventar', label: 'Inventar', icon: Package },
  ] },
  { title: 'Planen & Auswerten', items: [
    { to: '/budgets', label: 'Budgets', icon: Target },
    { to: '/sparziele', label: 'Sparziele', icon: PiggyBank },
    { to: '/sammlungen', label: 'Sammlungen', icon: FolderHeart },
    { to: '/prognose', label: 'Prognose', icon: TrendingUp },
    { to: '/auswertungen', label: 'Auswertungen', icon: BarChart3 },
  ] },
  { title: 'Verwaltung', items: [
    { to: '/kategorien', label: 'Kategorien', icon: Tags },
    { to: '/regeln', label: 'Regeln', icon: Wand2 },
    { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
  ] },
];

function Logo() {
  return (
    <span className="grid place-items-center w-8 h-8 rounded-lg bg-accent text-on-accent shadow-sm" aria-hidden>
      <Compass size={18} strokeWidth={2.25} />
    </span>
  );
}

/** Umschalter hell/dunkel; die Wahl wird gespeichert (zurück auf „wie System“ unter Einstellungen). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln';
  const onClick = () => {
    const root = document.documentElement;
    root.classList.add('theme-anim');
    toggle();
    window.setTimeout(() => root.classList.remove('theme-anim'), 250);
  };
  return (
    <button type="button" className="btn-ghost w-9 px-0 rounded-full border border-border bg-surface" onClick={onClick} aria-label={label} title={label}>
      {dark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}

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
  // Buchungen einer Auswertung in eigenem Tab: volle Breite, ohne Menü und Kopfzeile
  const bare = !!useMatch('/details/:id');
  const txDialog = dialog && <TxDialog onClose={() => setDialog(null)} edit={dialog.edit} initialMode={dialog.mode} initialAccount={dialog.account} />;

  if (bare) {
    return (
      <TxContext.Provider value={{ openNew, openEdit }}>
        <main className="px-4 lg:px-8 py-6 min-h-full">
          <Outlet />
        </main>
        {txDialog}
      </TxContext.Provider>
    );
  }

  return (
    <TxContext.Provider value={{ openNew, openEdit }}>
      <div className="min-h-full lg:grid lg:grid-cols-[248px_1fr]">
        <aside className={`${navOpen ? 'flex' : 'hidden'} lg:flex flex-col fixed lg:sticky top-0 z-40 lg:z-auto h-screen w-[248px] bg-surface border-r border-border`}>
          <div className="h-16 flex items-center gap-2.5 px-5 shrink-0">
            <Logo />
            <span className="font-semibold tracking-tight">Haushaltskompass</span>
            <button className="btn-ghost w-8 h-8 px-0 ml-auto lg:hidden" aria-label="Menü schließen" onClick={() => setNavOpen(false)}><X size={18} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Hauptnavigation">
            {NAV.map((g, gi) => (
              <div key={gi} className={gi ? 'mt-5' : 'mt-1'}>
                {g.title && <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted/80">{g.title}</div>}
                <div className="space-y-0.5">
                  {g.items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink key={to} to={to} end={end} onClick={() => setNavOpen(false)}
                      className={({ isActive }) => `group flex items-center gap-3 px-3 h-9 rounded-lg text-sm transition-colors ${isActive ? 'bg-accent-soft text-accent font-semibold' : 'text-text-muted hover:text-text hover:bg-surface-2'}`}>
                      <Icon size={18} aria-hidden className="shrink-0" />{label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="m-3 mt-0 p-3 rounded-lg bg-surface-2 text-xs shrink-0">
            <div className="truncate font-medium text-text" title={name}>{name}</div>
            <div className="flex items-center gap-1.5 text-text-muted mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${saving ? 'bg-warning animate-pulse' : 'bg-success'}`} aria-hidden />
              {saving ? 'Wird gespeichert …' : 'Lokal gespeichert'}
            </div>
          </div>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
        <div className="min-w-0">
          <header className="sticky top-0 z-20 h-16 bg-bg/80 backdrop-blur-md border-b border-border/70 flex items-center gap-3 px-4 lg:px-10">
            <button className="btn-ghost w-9 px-0 lg:hidden" aria-label="Menü" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
            <span className="lg:hidden flex items-center gap-2 font-semibold"><Logo /><span className="hidden sm:inline">Haushaltskompass</span></span>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden md:inline text-xs text-text-muted mr-1">Taste <kbd className="px-1.5 py-0.5 border border-border rounded bg-surface font-sans">N</kbd> für neue Buchung</span>
              <ThemeToggle />
              <button className="btn-primary rounded-full px-4" onClick={() => openNew()}><Plus size={16} />Neue Buchung</button>
            </div>
          </header>
          <main className="px-4 lg:px-10 py-6 lg:py-8 max-w-[1400px]">
            <DrillProvider><Outlet /></DrillProvider>
          </main>
        </div>
      </div>
      {txDialog}
    </TxContext.Provider>
  );
}
