import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * App-Sperre: PIN oder Kennwort vor dem Öffnen und nach einer Zeit ohne Bedienung.
 * Gespeichert wird nur ein PBKDF2-Hash im Browser (localStorage), nicht in der .hkb-Sicherung.
 * Die Sperre schützt die Anzeige, verschlüsselt aber die Daten im Browser nicht.
 */
const KEY = 'hk:app-lock';
const UNLOCKED = 'hk:unlocked';
const ITER = 150_000;

export interface LockConfig { salt: string; hash: string; minutes: number }

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch { return null; }
}

let cache = read();
let locked = !!cache && sessionUnlocked() !== true;

function sessionUnlocked(): boolean {
  try { return sessionStorage.getItem(UNLOCKED) === '1'; } catch { return false; }
}
function setSession(v: boolean) {
  try { if (v) sessionStorage.setItem(UNLOCKED, '1'); else sessionStorage.removeItem(UNLOCKED); } catch { /* egal */ }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER }, key, 256));
}

export function lockConfig(): LockConfig | null { return cache; }

export async function setLock(pin: string, minutes: number) {
  if (pin.length < 4) throw new Error('Bitte mindestens 4 Zeichen verwenden.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  cache = { salt: hex(salt.buffer), hash: await derive(pin, salt), minutes };
  localStorage.setItem(KEY, JSON.stringify(cache));
  setSession(true);
  emit();
}

export function setLockMinutes(minutes: number) {
  if (!cache) return;
  cache = { ...cache, minutes };
  localStorage.setItem(KEY, JSON.stringify(cache));
  emit();
}

export async function verifyPin(pin: string): Promise<boolean> {
  const c = cache ?? read();
  if (!c) return true;
  return (await derive(pin, unhex(c.salt))) === c.hash;
}

export function clearLock() {
  localStorage.removeItem(KEY);
  cache = null;
  locked = false;
  emit();
}

export async function unlock(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false;
  locked = false;
  setSession(true);
  emit();
  return true;
}

export function lockNow() {
  if (!cache) return;
  locked = true;
  setSession(false);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  // in einem anderen Tab eingerichtet oder entfernt
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = read(); if (!cache) locked = false; l(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}

export function useLockState(): { enabled: boolean; locked: boolean; minutes: number } {
  const enabled = useSyncExternalStore(subscribe, () => !!cache);
  const isLocked = useSyncExternalStore(subscribe, () => locked);
  const minutes = useSyncExternalStore(subscribe, () => cache?.minutes ?? 0);
  return { enabled, locked: enabled && isLocked, minutes };
}

/** Sperrt nach `minutes` ohne Maus, Tastatur oder Berührung (0 = nur beim Öffnen). */
export function useIdleLock() {
  const { enabled, locked: isLocked, minutes } = useLockState();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || isLocked || !minutes) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => { if (Date.now() - last >= minutes * 60_000) { lockNow(); setTick((t) => t + 1); } }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(id); };
  }, [enabled, isLocked, minutes, tick]);
}
