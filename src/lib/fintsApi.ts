import type { FintsAccountData } from '../db/fints';

/** Antworten des lokalen FinTS-Dienstes (siehe vite-plugin-fints.ts). */
export type FintsStep =
  | { step: 'tan'; challenge: string; decoupled: boolean; photo: string | null; hhduc: string | null; pollSeconds: number }
  | { step: 'choose-tan'; methods: { id: number; name: string; decoupled: boolean; media: string[] }[] }
  | { step: 'accounts'; bankName: string | null; accounts: FintsBankAccount[] }
  | { step: 'statement'; data: FintsAccountData }
  | { step: 'error'; message: string };

export interface FintsBankAccount {
  key: string; iban: string | null; accountNumber: string; name: string | null; holder: string | null; type: string; statements: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/__hk/fints${path}`, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    });
  } catch {
    throw new Error('Der lokale Bankdienst ist nicht erreichbar. Er läuft nur, wenn die App mit „npm run dev“ gestartet wurde.');
  }
  if (res.status === 404) throw new Error('Der lokale Bankdienst ist nicht verfügbar. Er läuft nur, wenn die App mit „npm run dev“ gestartet wurde.');
  if (!res.ok) throw new Error(`Bankdienst: Fehler ${res.status}`);
  return res.json() as Promise<T>;
}

export const fintsApi = {
  config: () => call<{ configured: boolean; logins: Record<string, string> }>('/config'),
  setProductId: (produktId: string) => call<{ configured: boolean }>('/config', { produktId }),
  connect: (p: { blz: string; url: string; userId: string; pin: string; remember: boolean }) => call<FintsStep & { session: string }>('/connect', p),
  chooseTan: (session: string, tanMethodId: number, tanMedia?: string) => call<FintsStep>('/tan-method', { session, tanMethodId, tanMedia }),
  tan: (session: string, tan?: string) => call<FintsStep>('/tan', { session, tan }),
  statements: (session: string, key: string, from: string) => call<FintsStep>('/statements', { session, key, from }),
  close: (session: string) => call<unknown>('/close', { session }).catch(() => undefined),
};
