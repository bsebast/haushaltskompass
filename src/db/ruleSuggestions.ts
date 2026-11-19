import type { Book } from './core';
import type { Rule } from './types';
import { listCategories, listRules, saveRule } from './repo';
import { findCategoryByLabel } from './contracts';

/**
 * Vorschlagsregeln für häufige Händler, Versorger und Buchungsarten in deutschen Kontoauszügen.
 * Ziel ist der Kategoriepfad der Standardkategorien; fehlt eine Kategorie, wird die Regel ausgelassen.
 */
export const SUGGESTED_RULES: [value: string, category: string, op?: 'regex'][] = [
  ['edeka', 'Lebensmittel › Supermarkt'], ['rewe', 'Lebensmittel › Supermarkt'], ['aldi', 'Lebensmittel › Supermarkt'],
  ['lidl', 'Lebensmittel › Supermarkt'], ['kaufland', 'Lebensmittel › Supermarkt'], ['netto marken', 'Lebensmittel › Supermarkt'],
  ['penny', 'Lebensmittel › Supermarkt'], ['\\bnorma\\b', 'Lebensmittel › Supermarkt', 'regex'], ['tegut', 'Lebensmittel › Supermarkt'],
  ['bäckerei', 'Lebensmittel › Bäcker & Markt'], ['baeckerei', 'Lebensmittel › Bäcker & Markt'], ['getränke', 'Lebensmittel › Getränke'],
  ['rossmann', 'Einkäufe › Drogerie'], ['dm-drogerie', 'Einkäufe › Drogerie'], ['dm drogerie', 'Einkäufe › Drogerie'],
  ['müller drogerie', 'Einkäufe › Drogerie'], ['amazon', 'Einkäufe'], ['zalando', 'Einkäufe › Kleidung'],
  ['apotheke', 'Gesundheit › Apotheke'],
  ['\\baral\\b', 'Mobilität › Kraftstoff', 'regex'], ['\\bshell\\b', 'Mobilität › Kraftstoff', 'regex'], ['\\besso\\b', 'Mobilität › Kraftstoff', 'regex'],
  ['tankstelle', 'Mobilität › Kraftstoff'], ['\\bavia\\b', 'Mobilität › Kraftstoff', 'regex'], ['totalenergies', 'Mobilität › Kraftstoff'],
  ['deutsche bahn', 'Mobilität › ÖPNV & Bahn'], ['db vertrieb', 'Mobilität › ÖPNV & Bahn'],
  ['netflix', 'Abos & Medien › Streaming'], ['spotify', 'Abos & Medien › Streaming'], ['disney plus', 'Abos & Medien › Streaming'],
  ['audible', 'Abos & Medien › Streaming'], ['dazn', 'Abos & Medien › Streaming'],
  ['apple.com/bill', 'Abos & Medien › Software'], ['microsoft', 'Abos & Medien › Software'],
  ['telekom', 'Wohnen › Internet & Telefon'], ['vodafone', 'Wohnen › Internet & Telefon'], ['telefonica', 'Wohnen › Internet & Telefon'],
  ['enbw', 'Wohnen › Strom'], ['tibber', 'Wohnen › Strom'], ['stadtwerke', 'Wohnen › Strom'],
  ['krankenversicherung', 'Versicherungen › Kranken'], ['krankenkasse', 'Versicherungen › Kranken'],
  ['lebensversicherung', 'Versicherungen › Leben & Rente'], ['standard life', 'Versicherungen › Leben & Rente'],
  ['haftpflicht', 'Versicherungen › Haftpflicht'], ['hausrat', 'Versicherungen › Hausrat'],
  ['restaurant', 'Freizeit › Restaurant & Café'], ['mcdonalds', 'Freizeit › Restaurant & Café'], ['betriebsrest', 'Freizeit › Restaurant & Café'],
  ['finanzamt', 'Finanzen › Steuern'], ['rundfunk', 'Abos & Medien'],
  ['ertraegnisgutschrift', 'Zinsen & Dividenden'], ['ertragsgutschrift', 'Zinsen & Dividenden'], ['kupon', 'Zinsen & Dividenden'],
  ['lohn-/gehalt', 'Gehalt & Lohn'], ['familienkasse', 'Kindergeld'],
  ['abschluss', 'Finanzen › Bankgebühren'], ['kartenentgelt', 'Finanzen › Bankgebühren'],
  // häufige Händler auf Kreditkartenabrechnungen, auch auf Reisen
  ['\\b(coop|willys|ica kvantum|carrefour|delhaize|7-eleven|spar)\\b', 'Lebensmittel › Supermarkt', 'regex'],
  ['\\b(pizzeria|pizza|kebab|burger|grill|cantina|trattoria|taverna|bistro|rooftop|pasta|taco)\\b', 'Freizeit › Restaurant & Café', 'regex'],
  ['\\b(caf[eé]|coffee|konditorei|p[aâ]tisserie)(?![a-z])', 'Freizeit › Restaurant & Café', 'regex'], ['restaura', 'Freizeit › Restaurant & Café'],
  ['lieferando', 'Freizeit › Restaurant & Café'], ['burger king', 'Freizeit › Restaurant & Café'],
  ['\\b(hotel|resort|hostel|booking\\.com|expedia|trip\\.com|stayforlong|airbnb)\\b', 'Freizeit › Urlaub', 'regex'],
  ['\\b(lufthansa|finnair|eurowings|ryanair|easyjet|condor|sas)\\b', 'Freizeit › Urlaub', 'regex'],
  ['\\b(sixt|europcar|hertz|avis)\\b', 'Freizeit › Urlaub', 'regex'],
  ['\\b(park(en|haus|ing|platz|pl)?|easypark|avantpark|epark\\w*|\\w*parkering\\w*)\\b', 'Mobilität › Parken', 'regex'],
  ['\\b(ladevorgang|charge session|charging|charge it easy|vaylens|ionity|circle k|st1)\\b', 'Mobilität › Kraftstoff', 'regex'],
  ['\\b(stib|vasttrafik|flygbussarna|f[aä]hre|bvg|mvv|vvs|hvv)\\b', 'Mobilität › ÖPNV & Bahn', 'regex'],
  ['\\b(ticketmaster|eventbrite|eventim|cinemaxx|kinoheld|museum|tickets)\\b', 'Freizeit › Kultur & Events', 'regex'],
  ['\\b(therme|thermen|badewelt|schwimmbad)\\b', 'Freizeit › Sport', 'regex'],
  ['\\b(intersport|decathlon|asics)\\b', 'Einkäufe › Kleidung', 'regex'], ['\\bm(ü|ue)ller\\b', 'Einkäufe › Drogerie', 'regex'],
  ['\\b(aliexpress|ebay|limango|temu)\\b', 'Einkäufe', 'regex'], ['\\b(expert|mediamarkt|saturn)\\b', 'Einkäufe › Elektronik', 'regex'],
  ['\\b(baumarkt|obi|hornbach|bauhaus)\\b', 'Wohnen › Reparaturen', 'regex'], ['\\b(m[oö]bel|ikea)\\b', 'Wohnen › Einrichtung', 'regex'],
  ['\\b(osiander|thalia|hugendubel)\\b', 'Freizeit › Hobbys', 'regex'],
  ['\\b(e\\.on|fairenergie)\\b', 'Wohnen › Strom', 'regex'],
  ['stellantis', 'Mobilität'],
];

/** Vorschlagsregeln als (noch nicht gespeicherte) Regeln, nur für Werte, die es noch nicht gibt. */
export function pendingSuggestedRules(b: Book): Rule[] {
  const cats = listCategories(b);
  const have = new Set(listRules(b).map((r) => r.value.toLowerCase()));
  const out: Rule[] = [];
  SUGGESTED_RULES.forEach(([value, path, op], i) => {
    if (have.has(value)) return;
    const cat = findCategoryByLabel(cats, path);
    if (!cat) return;
    out.push({ id: `suggest-${i}`, field: 'any', op: op ?? 'contains', value, category_id: cat.id, priority: 500 + i, enabled: 1 } as Rule);
  });
  return out;
}

/** Legt die fehlenden Vorschlagsregeln an und gibt ihre Anzahl zurück. */
export function addSuggestedRules(b: Book): number {
  const rules = pendingSuggestedRules(b);
  b.tx(() => rules.forEach((r) => saveRule(b, { field: r.field, op: r.op, value: r.value, category_id: r.category_id, priority: r.priority })));
  return rules.length;
}
