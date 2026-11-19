# Architecture: Haushaltskompass (Nachbau der Kernfunktionen eines Desktop-Haushaltsbuchs)

Entscheidung des Nutzers (2026-11-19): **lokale Web-App, später Desktop**. Daher weicht der Stack bewusst vom Cloud-Default des Skills ab: kein Server, kein Login, keine Zahlungen. Alle Daten bleiben auf dem Rechner.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Vite + React 18 + TypeScript | schnell, simpel, ohne Server; später 1:1 in Tauri nutzbar |
| styling | Tailwind CSS, Tokens aus replica-design | konsistentes eigenes Design |
| routing | React Router | eine Route je Screen (S-IDs) |
| database | SQLite im Browser über sql.js (WASM), persistiert in IndexedDB/OPFS | echte SQL-Abfragen für Auswertungen, eine Datei = ein Haushaltsbuch, Export als .sqlite |
| desktop (später) | Tauri 2 mit nativer SQLite-Datei | kleines Programm, Daten als normale Datei |
| Verschlüsselung | Web Crypto: AES-GCM, Schlüssel per PBKDF2 aus Passwort (≥ 600 000 Iterationen) | „lokale Verschlüsselung“ wie im Original, ohne Fremdbibliothek |
| charts | Recharts | Linie, Balken, Donut reichen für alle Auswertungen |
| CSV | Papa Parse + eigene Bankprofile | robuste Erkennung von Trennzeichen und Zeichensatz |
| tests | Vitest (Datenlayer, Import, Regeln), Playwright (Flows) | replica-test |
| auth / payments / email / jobs | entfällt | lokale Einzelplatz-App |
| hosting | keins nötig; optional GitHub Pages für eine Demo | – |

## Schema

Tables: 11 (siehe `schema.sql`). Access rules: entfällt (Einzelnutzer, lokale Datei); Integritätsregeln im Datenlayer.

Kernentscheidungen:
- Betrag als Integer-Cent mit Vorzeichen; Umbuchung = zwei Buchungen mit gemeinsamer `transfer_id`, die in Auswertungen ausgeschlossen werden.
- Split: Buchung ohne Kategorie + `splits`-Zeilen; Summe muss stimmen.
- Import-Dubletten: eindeutiger Index auf `(account_id, import_hash)`, Hash aus Datum, Betrag, Empfänger, Verwendungszweck und laufender Nummer bei identischen Zeilen.

## Datenlayer (statt API)

Ein Modul `src/db/` mit Funktionen je Flow; die UI ruft nur diese auf (später austauschbar gegen Tauri-SQLite).

| function | does | input | output | flow |
| --- | --- | --- | --- | --- |
| createBook / openBook / lockBook | Datei anlegen, öffnen, entschlüsseln | name, password? | Book | F01, F09 |
| listAccounts / saveAccount / archiveAccount | Konten | Account | Account[] mit Saldo | F01 |
| listTransactions(filter) | Liste mit Suche, Konto, Zeitraum, Kategorie | Filter | Transaction[] | F02, F06 |
| saveTransaction / deleteTransaction | Einnahme, Ausgabe inkl. Splits; Regeln anwenden, falls Kategorie leer | Tx + Splits | Tx | F02, F03 |
| saveTransfer | Umbuchung zwischen zwei Konten | from, to, amount, date | 2 Tx | F02 |
| importCsv(file, profile) → preview → commit | Bank-CSV einlesen, Mapping, Dubletten | File, Profil | Vorschau, Anzahl | F04 |
| listCategories / saveCategory / moveCategory | Kategoriebaum | Category | Tree | – |
| listRules / saveRule / testRule / applyRules | automatische Kategorisierung | Rule | Treffer | F02, F04 |
| budgetStatus(month) | Ist/Soll je Budget | YYYY-MM | Status[] | F05 |
| report.*(range) | Monat, Jahr, Vergleich, Kategorienanteile, Saldenverlauf, Monatsrest, Top-Kosten | Zeitraum | Reihen | F06 |
| detectRecurring() | wiederkehrende Kosten vorschlagen | – | Recurring[] | F07 |
| attachDocument / listDocuments | Belege | File, txId | Document | F08 |
| backup() / restore(file) | verschlüsselte Sicherung | Passwort | Datei | F09 |
| exportCsv(filter) | Buchungen als CSV | Filter | Datei | – |

Webhooks: keine. Jobs: keine Hintergrundjobs; Erkennung wiederkehrender Kosten läuft beim Öffnen und nach Importen.

## The parts that bite

- Datum: Buchungstage als `YYYY-MM-DD` ohne Zeitzone speichern; nie `new Date('2026-03-31')` für Monatsrechnungen (UTC-Verschiebung).
- Rundung: nur Integer-Cent; Eingabe „12,5“, „12.50“, „1.234,56“ korrekt parsen (deutsches Format).
- Persistenz: sql.js hält die DB im Speicher; nach jeder Schreiboperation entprellt in IndexedDB sichern; Warnung, wenn der Browser-Speicher geleert werden könnte; regelmäßige Backup-Erinnerung.
- Zwei Tabs gleichzeitig: Sperre über BroadcastChannel/Web Locks, sonst überschreibt ein Tab den anderen.
- Passwort vergessen = Daten weg (ehrlich kommunizieren, Backup anbieten).
- CSV-Formate: Sparkasse (CAMT-CSV), ING, DKB, Volksbank; Windows-1252 vs. UTF-8; Vorzeichen in eigener Spalte „S/H“.
- Dateigröße: Belege als BLOB in der DB, Limit 20 MB je Datei; DB-Größe im Auge behalten.
- Wiederkehrende Kosten: Toleranz für Betrag (±10 %) und Tag (±5 Tage).

## Build order

1. **Vertical slice** – S01, S03, S05, S06: Haushaltsbuch anlegen, Konto anlegen, Ausgabe/Einnahme erfassen, Liste und Saldo sehen. Tabellen: meta, accounts, categories (Seed), transactions.
2. **Must-haves** – Umbuchung, Split, Suche/Filter, Kategoriebaum (S08), Regeln (S09), Budgets (S10), Dashboard (S02), Monats-/Jahresübersicht + Monatsvergleich (S11).
3. **Should-haves** – weitere Diagramme, Sparpotenzial, wiederkehrende Kosten (S12), Belege (S13), Verschlüsselung + Backup (S15), pauschale Erfassung, Blöcke anpassen.
4. **Could-haves** – CSV-Import (S14, wegen Nutzen früh einplanbar), Export, Schnellerfassung, Steuerkategorie-Summen, Favoriten.
5. **Fixes aus replica-entrepreneur** – sobald gelaufen.
