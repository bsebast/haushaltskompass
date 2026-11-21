/** Nur im Dev-Server: spielt die neueste Sicherung aus privat/ in die App ein. */
export const IMPORT_MARKER = 'haushaltskompass.eingespielteSicherung';

export interface IncomingBackup {
  name: string;
  sha256: string;
  data: Uint8Array;
}

function marker(): string | null | undefined {
  try {
    return localStorage.getItem(IMPORT_MARKER);
  } catch {
    return undefined; // ohne Merker lieber nichts einspielen, sonst würde jeder Start überschreiben
  }
}

export function markImported(sha256: string) {
  localStorage.setItem(IMPORT_MARKER, sha256);
}

export async function fetchNewBackup(): Promise<IncomingBackup | null> {
  const known = marker();
  if (known === undefined) return null;
  const res = await fetch('/__hk/backup/latest', { cache: 'no-store' });
  if (res.status !== 200) return null;
  const info = (await res.json()) as { name: string; sha256: string };
  if (info.sha256 === known) return null;
  const file = await fetch(`/__hk/backup/file?sha256=${info.sha256}`, { cache: 'no-store' });
  if (!file.ok) return null;
  return { ...info, data: new Uint8Array(await file.arrayBuffer()) };
}

/** Legt den bisherigen Stand in privat/vor-import/ ab. Schlägt das fehl, wird nicht eingespielt. */
export async function keepCurrent(data: Uint8Array) {
  const res = await fetch('/__hk/backup/before-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data as BodyInit,
  });
  if (!res.ok) throw new Error('Der bisherige Stand konnte nicht gesichert werden.');
}

export function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? (navigator.locks.request('haushaltskompass-import', fn) as Promise<T>) : fn();
}
