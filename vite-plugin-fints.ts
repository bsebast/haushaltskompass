import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
  FinTSClient, FinTSConfig, AccountType,
  type BankAccount, type BankingInformation, type ClientResponse, type StatementResponse, type Statement,
} from 'lib-fints';

/**
 * Lokaler FinTS-Dienst (nur im Dev-Server auf dem eigenen PC). Der Browser darf Bankserver wegen CORS nicht
 * direkt ansprechen, deshalb läuft der FinTS-Dialog hier in Node.
 *
 * Datenschutz: PIN und TAN werden nur im Arbeitsspeicher für die laufende Sitzung gehalten, nie gespeichert
 * oder protokolliert. Auf der Platte (privat/fints/, nicht im Git) liegen nur die Produktnummer, die
 * Bankparameter samt Kundensystem-ID und auf Wunsch der Anmeldename.
 */

export const PRODUCT_VERSION = '0.1';
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 64 * 1024;

export interface TanStep {
  step: 'tan';
  challenge: string;
  decoupled: boolean;
  /** photoTAN-Grafik als data:-URL */
  photo: string | null;
  /** chipTAN-Flickercode (wird nur als Hinweis angezeigt) */
  hhduc: string | null;
  /** Sekunden zwischen automatischen Statusabfragen bei App-Freigabe */
  pollSeconds: number;
}
export interface FintsAccount {
  key: string; iban: string | null; accountNumber: string; name: string | null; holder: string | null;
  type: string; statements: boolean;
}
export type Step =
  | TanStep
  | { step: 'choose-tan'; methods: { id: number; name: string; decoupled: boolean; media: string[] }[] }
  | { step: 'accounts'; bankName: string | null; accounts: FintsAccount[] }
  | { step: 'statement'; data: FintsStatementData }
  | { step: 'error'; message: string };

export interface FintsStatementData {
  iban: string | null; accountNumber: string; accountName: string | null; bank: string | null; holder: string | null;
  openingBalance: number | null; closingBalance: number | null;
  transactions: { date: string; valueDate: string | null; amount: number; name: string; counterAccount: string | null; purpose: string; bookingText: string }[];
}

interface SavedState { bankingInformation: BankingInformation; tanMethodId?: number; tanMediaName?: string; userId?: string; blz: string }

interface Session {
  id: string;
  client: FinTSClient;
  file: string;
  blz: string;
  userId: string;
  remember: boolean;
  pending: null | { op: 'sync' } | { op: 'statements'; key: string };
  /** TAN-Referenz des wartenden Auftrags */
  ref?: string;
  syncRounds: number;
  touched: number;
}

const cents = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? null : Math.round(v * 100));
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const accountKey = (a: BankAccount) => `${a.accountNumber}/${a.subAccountId ?? ''}`;

/** Bankmeldungen in lesbarer Form, ohne Fehlercodes für Erfolg (0xxx) und Hinweise (3xxx) */
export function bankMessage(r: ClientResponse | undefined, fallback: string): string {
  const errs = (r?.bankAnswers ?? []).filter((a) => a.code >= 9000).map((a) => `${a.text} (${a.code})`);
  return errs.length ? errs.join(' · ') : fallback;
}

/** Wandelt die Kontoauszüge der Bibliothek in Cent-Beträge und Tagesdaten um. */
export function toStatementData(a: BankAccount, bankName: string | null, statements: Statement[]): FintsStatementData {
  const txs = statements.flatMap((s) => s.transactions ?? []);
  const withOpening = statements.filter((s) => s.openingBalance && !Number.isNaN(s.openingBalance.value));
  const withClosing = statements.filter((s) => s.closingBalance && !Number.isNaN(s.closingBalance.value));
  return {
    iban: a.iban ?? null,
    accountNumber: a.accountNumber,
    accountName: a.product ?? null,
    bank: bankName,
    holder: a.holder1 ?? null,
    openingBalance: withOpening.length ? cents(withOpening[0].openingBalance.value) : null,
    closingBalance: withClosing.length ? cents(withClosing[withClosing.length - 1].closingBalance.value) : null,
    transactions: txs.map((t) => ({
      date: isoDay(t.entryDate ?? t.valueDate),
      valueDate: t.valueDate ? isoDay(t.valueDate) : null,
      amount: Math.round(t.amount * 100),
      name: t.remoteName ?? '',
      counterAccount: t.remoteAccountNumber ?? null,
      purpose: t.purpose ?? '',
      bookingText: t.bookingText ?? '',
    })),
  };
}

export class FintsService {
  private sessions = new Map<string, Session>();

  constructor(private dir: string) {}

  private get configFile() { return join(this.dir, 'fints.json'); }

  productId(): string | null {
    if (process.env.HK_FINTS_PRODUKT_ID) return process.env.HK_FINTS_PRODUKT_ID;
    if (!existsSync(this.configFile)) return null;
    try { return (JSON.parse(readFileSync(this.configFile, 'utf8')) as { produktId?: string }).produktId || null; } catch { return null; }
  }

  setProductId(id: string) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.configFile, JSON.stringify({ produktId: id.trim() }, null, 2));
  }

  /** gemerkte Anmeldenamen je BLZ */
  logins(): Record<string, string> {
    const out: Record<string, string> = {};
    const f = join(this.dir, 'logins.json');
    if (existsSync(f)) try { Object.assign(out, JSON.parse(readFileSync(f, 'utf8'))); } catch { /* ignorieren */ }
    return out;
  }

  private rememberLogin(blz: string, userId: string | null) {
    const all = this.logins();
    if (userId) all[blz] = userId; else delete all[blz];
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'logins.json'), JSON.stringify(all, null, 2));
  }

  private stateFile(blz: string, userId: string) {
    const h = createHash('sha256').update(`${blz}|${userId}`).digest('hex').slice(0, 16);
    return join(this.dir, 'banken', `${blz}-${h}.json`);
  }

  private save(s: Session) {
    const c = s.client.config;
    const state: SavedState = { blz: s.blz, bankingInformation: c.bankingInformation, tanMethodId: c.tanMethodId, tanMediaName: c.tanMediaName };
    mkdirSync(join(this.dir, 'banken'), { recursive: true });
    writeFileSync(s.file, JSON.stringify(state));
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.touched > SESSION_TTL_MS) this.sessions.delete(id);
  }

  private session(id: unknown): Session {
    this.sweep();
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined;
    if (!s) throw new Error('Die Verbindung zur Bank ist abgelaufen. Bitte neu verbinden.');
    s.touched = Date.now();
    return s;
  }

  close(id: unknown) { if (typeof id === 'string') this.sessions.delete(id); }

  /** Baut die Verbindung auf und gleicht Bank- und Kontodaten ab. */
  async connect(p: { blz: string; url: string; userId: string; pin: string; remember?: boolean }, makeClient = (c: FinTSConfig) => new FinTSClient(c)): Promise<Step & { session: string }> {
    const productId = this.productId();
    if (!productId) throw new Error('Es ist noch keine FinTS-Produktnummer hinterlegt (Einstellungen → Bankabruf).');
    const blz = String(p.blz ?? '').replace(/\s/g, '');
    if (!/^\d{8}$/.test(blz)) throw new Error('Die Bankleitzahl muss 8 Ziffern haben.');
    if (!/^https:\/\//.test(p.url ?? '')) throw new Error('Die Adresse des Bankservers muss mit https:// beginnen.');
    if (!p.userId?.trim() || !p.pin) throw new Error('Bitte Anmeldename und PIN eingeben.');
    const userId = p.userId.trim();
    const file = this.stateFile(blz, userId);
    let config: FinTSConfig;
    let saved: SavedState | null = null;
    if (existsSync(file)) try { saved = JSON.parse(readFileSync(file, 'utf8')) as SavedState; } catch { saved = null; }
    if (saved?.bankingInformation?.bpd) {
      config = FinTSConfig.fromBankingInformation(productId, PRODUCT_VERSION, saved.bankingInformation, userId, p.pin, saved.tanMethodId, saved.tanMediaName);
    } else {
      config = FinTSConfig.forFirstTimeUse(productId, PRODUCT_VERSION, p.url, blz, userId, p.pin);
    }
    const s: Session = { id: randomUUID(), client: makeClient(config), file, blz, userId, remember: !!p.remember, pending: null, syncRounds: 0, touched: Date.now() };
    this.sweep();
    this.sessions.set(s.id, s);
    this.rememberLogin(blz, p.remember ? userId : null);
    const step = await this.sync(s);
    if (step.step === 'error') this.sessions.delete(s.id);
    return { ...step, session: s.id };
  }

  private async sync(s: Session): Promise<Step> {
    if (++s.syncRounds > 4) return { step: 'error', message: 'Die Bank hat nach mehreren Versuchen keine Konten geliefert.' };
    return this.afterSync(s, await s.client.synchronize());
  }

  private tanStep(s: Session, r: ClientResponse): TanStep {
    const m = s.client.config.selectedTanMethod;
    const photo = r.tanPhoto ? `data:${r.tanPhoto.mimeType};base64,${Buffer.from(r.tanPhoto.image).toString('base64')}` : null;
    return {
      step: 'tan', challenge: r.tanChallenge ?? 'Bitte den Auftrag freigeben.', decoupled: !!m?.isDecoupled, photo,
      hhduc: r.tanChallengeHhdUc ?? null,
      pollSeconds: Math.max(2, m?.decoupled?.waitingSecondsBetweenStatusRequests ?? 3),
    };
  }

  private async afterSync(s: Session, r: ClientResponse): Promise<Step> {
    if (r.requiresTan && r.tanReference) {
      s.pending = { op: 'sync' };
      s.ref = r.tanReference;
      return this.tanStep(s, r);
    }
    s.pending = null;
    if (!r.success) return { step: 'error', message: bankMessage(r, 'Die Bank hat die Anmeldung abgelehnt.') };
    const c = s.client.config;
    this.save(s);
    if (!c.selectedTanMethod) {
      const methods = c.availableTanMethods.filter((m) => m.id !== 999);
      if (methods.length === 1 && methods[0].tanMediaRequirement !== 2) {
        s.client.selectTanMethod(methods[0].id);
        return this.sync(s);
      }
      if (methods.length) {
        return { step: 'choose-tan', methods: methods.map((m) => ({ id: m.id, name: m.name, decoupled: m.isDecoupled, media: m.activeTanMedia ?? [] })) };
      }
    }
    const accounts = c.bankingInformation.upd?.bankAccounts ?? [];
    if (!accounts.length) return this.sync(s);
    return {
      step: 'accounts',
      bankName: c.bankingInformation.bpd?.bankName ?? null,
      accounts: accounts.map((a) => ({
        key: accountKey(a), iban: a.iban ?? null, accountNumber: a.accountNumber, name: a.product ?? null, holder: a.holder1 ?? null,
        type: a.accountType, statements: a.accountType !== AccountType.SecuritiesAccount && s.client.canGetAccountStatements(a),
      })),
    };
  }

  async chooseTan(p: { session: string; tanMethodId: number; tanMedia?: string }): Promise<Step> {
    const s = this.session(p.session);
    s.client.selectTanMethod(Number(p.tanMethodId));
    if (p.tanMedia) s.client.selectTanMedia(p.tanMedia);
    s.syncRounds = 0;
    return this.sync(s);
  }

  /** TAN senden bzw. bei App-Freigabe nachfragen, ob schon freigegeben wurde. */
  async tan(p: { session: string; tan?: string }): Promise<Step> {
    const s = this.session(p.session);
    const ref = s.ref;
    if (!s.pending || !ref) throw new Error('Es wartet gerade kein Auftrag auf eine TAN.');
    const tan = p.tan?.trim() || undefined;
    if (s.pending.op === 'sync') return this.afterSync(s, await s.client.synchronizeWithTan(ref, tan));
    const key = s.pending.key;
    return this.afterStatements(s, key, await s.client.getAccountStatementsWithTan(ref, tan));
  }

  async statements(p: { session: string; key: string; from?: string; to?: string }): Promise<Step> {
    const s = this.session(p.session);
    const a = this.account(s, p.key);
    const from = p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from) ? new Date(`${p.from}T00:00:00`) : undefined;
    const to = p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to) ? new Date(`${p.to}T00:00:00`) : undefined;
    return this.afterStatements(s, p.key, await s.client.getAccountStatements(a, from, to));
  }

  private account(s: Session, key: string): BankAccount {
    const a = (s.client.config.bankingInformation.upd?.bankAccounts ?? []).find((x) => accountKey(x) === key);
    if (!a) throw new Error('Das Konto ist bei der Bank nicht (mehr) bekannt.');
    return a;
  }

  private afterStatements(s: Session, key: string, r: StatementResponse): Step {
    if (r.bankingInformationUpdated) this.save(s);
    if (r.requiresTan && r.tanReference) {
      s.pending = { op: 'statements', key };
      s.ref = r.tanReference;
      return this.tanStep(s, r);
    }
    s.pending = null;
    if (!r.success) return { step: 'error', message: bankMessage(r, 'Die Bank hat keine Umsätze geliefert.') };
    return { step: 'statement', data: toStatementData(this.account(s, key), s.client.config.bankingInformation.bpd?.bankName ?? null, r.statements ?? []) };
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('zu groß')); req.destroy(); } else parts.push(c);
    });
    req.on('end', () => {
      try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { fail(e); }
    });
    req.on('error', fail);
  });
}

/** Nur im Dev-Server: FinTS-Routen unter /__hk/fints, ausschließlich für die eigene Seite. */
export function fintsBridge(): Plugin {
  return {
    name: 'haushaltskompass-fints',
    apply: 'serve',
    configureServer(server) {
      const svc = new FintsService(resolve(server.config.root, 'privat', 'fints'));
      server.middlewares.use('/__hk/fints', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.headers['sec-fetch-site'] !== 'same-origin') { res.statusCode = 403; res.end(); return; }
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        try {
          if (req.method === 'GET' && path === '/config') {
            send(200, { configured: !!svc.productId(), logins: svc.logins() });
            return;
          }
          if (req.method !== 'POST') { next(); return; }
          const body = await readJson(req);
          if (path === '/config') { svc.setProductId(String(body.produktId ?? '')); send(200, { configured: !!svc.productId() }); }
          else if (path === '/connect') send(200, await svc.connect(body as never));
          else if (path === '/tan-method') send(200, await svc.chooseTan(body as never));
          else if (path === '/tan') send(200, await svc.tan(body as never));
          else if (path === '/statements') send(200, await svc.statements(body as never));
          else if (path === '/close') { svc.close(body.session); send(200, {}); }
          else next();
        } catch (e) {
          // nie den Anfrageinhalt protokollieren: er kann PIN oder TAN enthalten
          let msg = (e as Error).message || 'Unbekannter Fehler';
          if (msg === 'fetch failed') msg = 'Der Bankserver ist nicht erreichbar. Stimmen die FinTS-Adresse und die Internetverbindung?';
          server.config.logger.error(`FinTS: ${msg}`);
          send(200, { step: 'error', message: msg });
        }
      });
    },
  };
}
