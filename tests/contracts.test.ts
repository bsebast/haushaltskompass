import { describe, it, expect } from 'vitest';
import { newBook } from './helpers';
import { parseDue, parseInterval, nextDue, perMonth, normalizeMonths, parseContractsCsv, commitContracts, listContracts, saveContract } from '../src/db/contracts';
import { saveAccount, listCategories } from '../src/db/repo';

describe('Verträge', () => {
  it('liest Fälligkeiten und Rhythmen', () => {
    expect(parseDue('01.')).toEqual({ day: 1, months: [] });
    expect(parseDue('01.01.')).toEqual({ day: 1, months: [1] });
    expect(parseDue('19.02., 15.05., 15.08., 15.11.')).toEqual({ day: 19, months: [2, 5, 8, 11] });
    expect(parseDue('25.03., 28.08.')).toEqual({ day: 25, months: [3, 8] });
    expect(parseInterval('quartalsweise')).toBe('quarterly');
    expect(parseInterval('halbjährlich')).toBe('halfyearly');
    expect(parseInterval('jährlich')).toBe('yearly');
    expect(normalizeMonths('quarterly', [2])).toEqual([2, 5, 8, 11]);
  });

  it('berechnet die nächste Fälligkeit', () => {
    expect(nextDue({ interval: 'monthly', due_day: 31, due_months: null, end_date: null }, '2026-02-10')).toBe('2026-02-28');
    expect(nextDue({ interval: 'yearly', due_day: 1, due_months: '1', end_date: null }, '2026-11-19')).toBe('2027-01-01');
    expect(nextDue({ interval: 'quarterly', due_day: 15, due_months: '2,5,8,11', end_date: null }, '2026-11-19')).toBe('2027-02-15');
    expect(perMonth({ amount: -12000, interval: 'yearly' })).toBe(-1000);
  });

  it('importiert eine CSV mit deutschen Spalten', async () => {
    const b = await newBook();
    const acc = saveAccount(b, { name: 'Giro', type: 'checking' });
    const csv = [
      'Vertrag;Vertragspartner;Zweck;Betrag;Rhythmus;Fälligkeit;Zahlart;Art;Kategorie;Bemerkung',
      'Musterversicherung;Anna;Haftpflicht;96,51;jährlich;01.01.;Lastschrift;Versicherung;Versicherungen › Haftpflicht;',
      'Streamingdienst;Anna;Medien;13,99;monatlich;09.;Lastschrift;Medien;Abos & Medien › Streaming;',
      'Kfz-Steuer;Anna;Steuer;0;jährlich;;Überweisung;Steuer;;später',
      'Wasser;Haushalt;Nebenkosten;248,71;quartalsweise;31.03., 30.06., 30.09., 31.12.;Lastschrift;Nebenkosten;Wohnen › Wasser;',
    ].join('\n');
    const rows = parseContractsCsv(b, csv);
    expect(rows.filter((r) => r.skip)).toHaveLength(1);
    expect(commitContracts(b, rows, acc)).toBe(3);
    const list = listContracts(b);
    expect(list).toHaveLength(3);
    expect(list.find((c) => c.name === 'Wasser')?.category_name).toBe('Wasser');
    expect(listCategories(b).some((c) => c.name === 'Wasser')).toBe(true);
    expect(parseContractsCsv(b, csv).filter((r) => r.duplicate)).toHaveLength(3);
  });

  it('beendete Verträge zählen nicht mit', async () => {
    const b = await newBook();
    saveContract(b, { name: 'Alt', amount: -500, interval: 'monthly', status: 'ended' });
    expect(listContracts(b)).toHaveLength(0);
    expect(listContracts(b, true)).toHaveLength(1);
  });
});
