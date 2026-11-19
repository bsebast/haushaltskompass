import { it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import schema from '../src/db/schema.sql?raw';
import { openBook, SCHEMA_VERSION } from '../src/db/core';
import { listContracts, saveContract } from '../src/db/contracts';

it('öffnet Bücher aus Version 0.1 und migriert sie', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(schema);
  db.run("insert into meta values ('schema_version', '1')");
  const b = openBook(SQL, db.export());
  expect(b.meta('schema_version')).toBe(String(SCHEMA_VERSION));
  saveContract(b, { name: 'Test', amount: -100, interval: 'monthly', due_day: 3 });
  expect(listContracts(b)[0].due_day).toBe(3);
});
