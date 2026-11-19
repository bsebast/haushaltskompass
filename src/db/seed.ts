import type { Book } from './core';
import { uid, now } from '../lib/id';

type Seed = [name: string, color: string, children?: string[]];

const EXPENSES: Seed[] = [
  ['Wohnen', '#7a5c3e', ['Miete', 'Nebenkosten', 'Strom', 'Internet & Telefon', 'Einrichtung', 'Reparaturen']],
  ['Lebensmittel', '#2f7d5b', ['Supermarkt', 'Bäcker & Markt', 'Getränke']],
  ['Mobilität', '#3d6a9e', ['Kraftstoff', 'ÖPNV & Bahn', 'Kfz-Versicherung', 'Werkstatt', 'Parken']],
  ['Versicherungen', '#6b5b95', ['Haftpflicht', 'Hausrat', 'Kranken', 'Leben & Rente']],
  ['Gesundheit', '#b0473a', ['Apotheke', 'Arzt']],
  ['Freizeit', '#c27c0e', ['Restaurant & Café', 'Hobbys', 'Kultur & Events', 'Urlaub', 'Sport']],
  ['Abos & Medien', '#8a4f7d', ['Streaming', 'Zeitschriften', 'Software']],
  ['Einkäufe', '#4f7f8a', ['Kleidung', 'Elektronik', 'Drogerie', 'Geschenke']],
  ['Kinder', '#d0663a', ['Betreuung', 'Schule', 'Taschengeld']],
  ['Finanzen', '#5a6470', ['Bankgebühren', 'Kredite', 'Sparen & Anlegen', 'Steuern']],
  ['Spenden', '#2b7a78'],
  ['Sonstiges', '#8a8478'],
];

const INCOME: Seed[] = [
  ['Gehalt & Lohn', '#1c7a45'],
  ['Kindergeld', '#2f8f5b'],
  ['Zinsen & Dividenden', '#3c9a6a'],
  ['Erstattungen', '#4aa679'],
  ['Sonstige Einnahmen', '#5ab287'],
];

export function seedDefaults(book: Book) {
  const t = now();
  const ins = (parent: string | null, name: string, kind: string, color: string, order: number) => {
    const id = uid();
    book.run(
      'insert into categories (id, parent_id, name, kind, color, sort_order, created_at, updated_at) values (?,?,?,?,?,?,?,?)',
      [id, parent, name, kind, color, order, t, t],
    );
    return id;
  };
  EXPENSES.forEach(([name, color, children], i) => {
    const pid = ins(null, name, 'expense', color, i);
    children?.forEach((c, j) => ins(pid, c, 'expense', color, j));
  });
  INCOME.forEach(([name, color, children], i) => {
    const pid = ins(null, name, 'income', color, i);
    children?.forEach((c, j) => ins(pid, c, 'income', color, j));
  });
  const blocks = ['month_left', 'balance_trend', 'budgets', 'top_categories', 'accounts', 'recent'];
  blocks.forEach((type, i) => book.run('insert into dashboard_blocks (id, type, position) values (?,?,?)', [uid(), type, i]));
}
