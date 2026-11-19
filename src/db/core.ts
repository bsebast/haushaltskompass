import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import schema from './schema.sql?raw';
import { seedDefaults } from './seed';
import { now } from '../lib/id';

export const SCHEMA_VERSION = 3;

/** Migrationen von Version n-1 auf n. Neue Bücher starten mit schema.sql (Version 1) und durchlaufen alle Migrationen. */
const MIGRATIONS: Record<number, string> = {
  2: `
    alter table recurring add column name text;
    alter table recurring add column person text;
    alter table recurring add column purpose text;
    alter table recurring add column kind text;
    alter table recurring add column payment_method text;
    alter table recurring add column due_day integer;
    alter table recurring add column due_months text;
    alter table recurring add column note text;
    alter table recurring add column start_date text;
    alter table recurring add column end_date text;
    create index idx_recurring_status on recurring(status);
  `,
  3: `
    create table accounts_new (
      id text primary key,
      name text not null check (length(name) between 1 and 80),
      type text not null check (type in ('cash','checking','household','credit','savings','fixed','depot','loan')),
      owner text,
      bank text,
      currency text not null default 'EUR',
      opening_balance integer not null default 0,
      iban text,
      interest_rate real,
      exemption integer,
      exemption_used integer,
      note text,
      sort_order integer not null default 0,
      archived integer not null default 0,
      created_at text not null, updated_at text not null
    );
    insert into accounts_new (id, name, type, owner, currency, opening_balance, iban, sort_order, archived, created_at, updated_at)
      select id, name, type, owner, currency, opening_balance, iban, sort_order, archived, created_at, updated_at from accounts;
    drop table accounts;
    alter table accounts_new rename to accounts;

    create table balance_snapshots (
      id text primary key,
      account_id text not null references accounts(id) on delete cascade,
      date text not null,
      balance integer not null,
      note text,
      unique (account_id, date)
    );

    create table holdings (
      id text primary key,
      account_id text references accounts(id) on delete set null,
      owner text,
      wkn text,
      isin text,
      name text not null,
      quantity real not null default 0,
      cost_value integer,
      price integer,
      market_value integer,
      as_of text,
      created_at text not null, updated_at text not null
    );
    create index idx_holdings_account on holdings(account_id);

    create table pensions (
      id text primary key,
      person text,
      provider text not null,
      contribution integer,
      interval text,
      lump_sum integer,
      monthly_pension integer,
      projection1 integer,
      projection2 integer,
      projection3 integer,
      start_text text,
      as_of text,
      advisor text,
      death_action text,
      note text,
      created_at text not null, updated_at text not null
    );

    alter table recurring add column notice_period text;
    alter table recurring add column doc_ref text;
    alter table recurring add column advisor text;
    alter table recurring add column death_action text;
  `,
};

function migrate(book: Book, from: number) {
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    // Tabellen-Neuaufbau braucht ausgeschaltete Fremdschlüssel, sonst würden abhängige Buchungen gelöscht
    book.db.run('PRAGMA foreign_keys = OFF');
    try {
      book.db.exec('BEGIN');
      book.db.exec(MIGRATIONS[v]);
      const bad = book.db.exec('PRAGMA foreign_key_check');
      if (bad.length) throw new Error('Migration verletzt Fremdschlüssel');
      book.db.exec('COMMIT');
    } catch (e) {
      book.db.exec('ROLLBACK');
      throw e;
    } finally {
      book.db.run('PRAGMA foreign_keys = ON');
    }
    book.db.run("insert into meta(key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value", [String(v)]);
  }
}
type Params = SqlValue[] | Record<string, SqlValue>;

/** Ein geöffnetes Haushaltsbuch (eine SQLite-Datenbank). */
export class Book {
  private listeners = new Set<() => void>();
  private depth = 0;
  private dirty = false;
  version = 0;

  constructor(public readonly db: Database) {
    db.run('PRAGMA foreign_keys = ON');
  }

  all<T = Record<string, SqlValue>>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T = Record<string, SqlValue>>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  value<T extends SqlValue = SqlValue>(sql: string, params: Params = []): T | undefined {
    const row = this.db.exec(sql, params as SqlValue[])[0];
    return row?.values[0]?.[0] as T | undefined;
  }

  run(sql: string, params: Params = []): void {
    this.db.run(sql, params);
    this.changed();
  }

  /** Führt fn in einer DB-Transaktion aus; bei Fehler wird alles zurückgerollt. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.run('BEGIN');
    try {
      const r = fn();
      this.db.run('COMMIT');
      return r;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
      if (this.dirty) this.flush();
    }
  }

  private changed() {
    this.dirty = true;
    if (this.depth === 0) this.flush();
  }

  private flush() {
    this.dirty = false;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  meta(key: string): string | undefined {
    return this.value<string>('select value from meta where key = ?', [key]);
  }

  setMeta(key: string, value: string) {
    this.run('insert into meta(key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [key, value]);
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close() {
    this.db.close();
    this.listeners.clear();
  }
}

export function createBook(SQL: SqlJsStatic, name: string, owner?: string): Book {
  const db = new SQL.Database();
  db.exec(schema);
  const book = new Book(db);
  book.db.run("insert into meta(key, value) values ('schema_version', '1')");
  migrate(book, 1);
  book.tx(() => {
    book.setMeta('book_name', name);
    if (owner) book.setMeta('owner', owner);
    book.setMeta('created_at', now());
    seedDefaults(book);
  });
  return book;
}

export function openBook(SQL: SqlJsStatic, data: Uint8Array): Book {
  const db = new SQL.Database(data);
  const book = new Book(db);
  const v = Number(book.meta('schema_version') ?? 0);
  if (!v) throw new Error('Die Datei ist kein Haushaltskompass-Haushaltsbuch.');
  if (v > SCHEMA_VERSION) throw new Error('Diese Datei stammt aus einer neueren Version des Programms.');
  if (v < SCHEMA_VERSION) migrate(book, v);
  return book;
}
