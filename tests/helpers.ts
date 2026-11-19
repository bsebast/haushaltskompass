import initSqlJs from 'sql.js';
import { createBook } from '../src/db/core';

export async function newBook() {
  const SQL = await initSqlJs();
  return createBook(SQL, 'Test');
}
