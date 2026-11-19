import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import schema from './schema.sql?raw';
import { seedDefaults } from './seed';
import { now } from '../lib/id';

export const SCHEMA_VERSION = 2;

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
};

function migrate(book: Book, from: number) {
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    book.db.exec(MIGRATIONS[v]);
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
