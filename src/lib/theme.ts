import { useCallback, useEffect, useState } from 'react';

/** Farbschema: „system“ folgt der Einstellung des Betriebssystems. */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'haushaltskompass.theme';
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== 'system') return pref;
  return media()?.matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

const listeners = new Set<(p: ThemePref) => void>();

export function setPref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* Auswahl gilt dann nur bis zum Neuladen */ }
  apply(resolveTheme(pref));
  listeners.forEach((l) => l(pref));
}

/** Aktuelle Auswahl und tatsächliches Schema; reagiert auf Systemwechsel, solange „system“ gewählt ist. */
export function useTheme() {
  const [pref, setState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readPref()));
  useEffect(() => {
    const onPref = (p: ThemePref) => { setState(p); setTheme(resolveTheme(p)); };
    listeners.add(onPref);
    const mq = media();
    const onSys = () => { if (readPref() === 'system') { const t = resolveTheme('system'); apply(t); setTheme(t); } };
    mq?.addEventListener('change', onSys);
    return () => { listeners.delete(onPref); mq?.removeEventListener('change', onSys); };
  }, []);
  const toggle = useCallback(() => setPref(theme === 'dark' ? 'light' : 'dark'), [theme]);
  return { pref, theme, setPref, toggle };
}
