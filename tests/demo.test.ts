import { it, expect } from 'vitest';
import { newBook } from './helpers';
import { seedDemo } from '../src/db/demo';
import { listTransactions } from '../src/db/repo';

it('Beispieldaten lassen sich anlegen', async () => {
  const b = await newBook();
  seedDemo(b);
  expect(listTransactions(b).length).toBeGreaterThan(200);
  expect(listTransactions(b, { uncategorized: true })).toHaveLength(0);
});
