import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Book, createBook, openBook } from './db/core';
import { loadFile, saveFile, deleteFile, requestPersistence } from './db/storage';

type Status = 'loading' | 'empty' | 'ready' | 'error';

interface Ctx {
  status: Status;
  error: string | null;
  book: Book | null;
  create: (name: string, owner?: string) => Book;
  load: (data: Uint8Array) => void;
  reset: () => Promise<void>;
  saving: boolean;
}

const BookContext = createContext<Ctx | null>(null);

export function BookProvider({ children }: { children: React.ReactNode }) {
  const [SQL, setSQL] = useState<SqlJsStatic | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const sql = await initSqlJs({ locateFile: () => wasmUrl });
        setSQL(sql);
        const data = await loadFile();
        if (data) {
          setBook(openBook(sql, data));
          setStatus('ready');
        } else {
          setStatus('empty');
        }
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    })();
  }, []);

  // Nach jeder Änderung entprellt speichern
  useEffect(() => {
    if (!book) return;
    const persist = () => {
      window.clearTimeout(timer.current);
      setSaving(true);
      timer.current = window.setTimeout(async () => {
        await saveFile(book.export());
        setSaving(false);
      }, 250);
    };
    const unsub = book.subscribe(persist);
    // Änderungen, die direkt nach dem Anlegen passiert sind (vor diesem Effekt), ebenfalls sichern
    persist();
    const flush = () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        void saveFile(book.export());
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flush);
    };
  }, [book]);

  const create = useCallback(
    (name: string, owner?: string) => {
      if (!SQL) throw new Error('Datenbank noch nicht geladen.');
      const b = createBook(SQL, name, owner);
      void saveFile(b.export());
      void requestPersistence();
      setBook(b);
      setStatus('ready');
      return b;
    },
    [SQL],
  );

  const load = useCallback(
    (data: Uint8Array) => {
      if (!SQL) throw new Error('Datenbank noch nicht geladen.');
      const b = openBook(SQL, data);
      void saveFile(b.export());
      book?.close();
      setBook(b);
      setStatus('ready');
    },
    [SQL, book],
  );

  const reset = useCallback(async () => {
    book?.close();
    await deleteFile();
    setBook(null);
    setStatus('empty');
  }, [book]);

  const value = useMemo(() => ({ status, error, book, create, load, reset, saving }), [status, error, book, create, load, reset, saving]);
  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBookCtx(): Ctx {
  const c = useContext(BookContext);
  if (!c) throw new Error('BookProvider fehlt');
  return c;
}

export function useBook(): Book {
  const { book } = useBookCtx();
  if (!book) throw new Error('Kein Haushaltsbuch geöffnet');
  return book;
}

/** Führt eine Abfrage aus und rechnet sie bei jeder Änderung am Haushaltsbuch neu. */
export function useQuery<T>(fn: (b: Book) => T, deps: unknown[] = []): T {
  const book = useBook();
  const version = useSyncExternalStore(
    (cb) => book.subscribe(cb),
    () => book.version,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(book), [book, version, ...deps]);
}
