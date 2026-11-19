# Recon map: Haushaltsbuch nach Vorbild „WISO Haushaltsbuch 2026“ (Desktop, Windows)

Scope: Persönliche Finanzverwaltung ohne Online-Banking: Konten, Buchungen, Kategorien, Budgets, Auswertungen, Belege, wiederkehrende Kosten.
For: Bernd (Eigennutzung), Arbeitsname „Haushaltskompass“ (wird in replica-brand final festgelegt)
Plattform des Nachbaus: lokale Web-App (React/TypeScript), später Tauri-Desktop
Date: 2026-11-19

> Clean-room: Diese Karte beschreibt Funktionen und Abläufe in eigenen Worten. Keine Texte, Grafiken, Logos oder Code des Originals werden übernommen.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Produktseite | https://www.buhl.de/software/wiso-haushaltsbuch/ | Feature-Abschnitte, FAQ, Systemvoraussetzungen, Preis 19,99 € |
| 2 | Schnelleinstieg / Handbuch (PDF) | https://www.buhl.de/wp-content/uploads/2026/06/wiso-haushaltsbuch-handbuch-2027.pdf | Oberfläche, Startseiten-Blöcke, Erfassung Einnahme/Ausgabe, Schnellerfassung |
| 3 | Leistungsübersicht Finanzsoftware (PDF) | https://www.buhl.de/wp-content/uploads/2026/06/leistungsuebersicht-finanzsoftware-2027.pdf | Bereiche der Produktfamilie; Häkchen für Haushaltsbuch nicht maschinenlesbar |
| 4 | Dashboard-Screenshot (Produktseite) | https://www.buhl.de/wp-content/uploads/2026/03/wiso-haushaltsbuch-dashboard.webp | nur Referenz, wird nicht gespeichert/verwendet |
| – | eigenes Konto | – | nicht vorhanden; nur öffentliche Quellen |

Lücken: Kein öffentliches Detailhandbuch zu Budgets, Import/Export, Einstellungen. Diese Bereiche sind unten als „guess“ markiert.

## Core loop

Ausgaben und Einnahmen schnell erfassen (oder importieren), automatisch kategorisieren lassen und sehen, wohin das Geld geht und ob die Budgets halten.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Ersteinrichtung | erster Start | Haushaltsbuch + erstes Konto anlegen (Typ, Name, Inhaber) | Wizard, Formular | leer |
| S02 | Startseite (Dashboard) | Navigation „Start“ | Überblick in frei anordenbaren Blöcken | Block-Grid, „Block hinzufügen“, Diagramme | leer, gefüllt |
| S03 | Konten | Navigation | alle Konten (Bargeld, Giro, Haushaltsbuch, Kreditkarte, Sparen) mit Saldo | Liste, Saldo, Kontofilter | leer, gefüllt |
| S04 | Konto anlegen/bearbeiten | S03 → Neu | Kontotyp, Name, Inhaber, Anfangssaldo | Formular, Dialog | neu, bearbeiten |
| S05 | Buchungen | Navigation, Klick auf Konto | Buchungsliste je Konto oder alle, Suche, Filter | Tabelle, Suchfeld, Filterleiste, Kontofilter | leer, gefüllt, keine Treffer |
| S06 | Buchung erfassen (Einnahme/Ausgabe/Umbuchung) | S05 → Neue Buchung | Datum, Betrag, Empfänger/Auftraggeber, Kategorie, Notiz, Beleg, Aufteilen | Formular, Kategorie-Picker, Split-Zeilen | neu, bearbeiten, Validierungsfehler |
| S07 | Schnellerfassung | globales Kürzel / eigenes Fenster | Beleg in Sekunden erfassen ohne Hauptansicht | Mini-Formular | – |
| S08 | Kategorien | Einstellungen/Navigation | Kategoriebaum Einnahmen/Ausgaben, optional Steuerkategorie | Baum, Drag & Drop, Dialog | Standardkategorien |
| S09 | Kategorisierungsregeln | S08 oder aus Buchung | Regeln „Empfänger/Verwendungszweck enthält X → Kategorie Y“ | Regelliste, Test-Vorschau | leer, gefüllt (guess) |
| S10 | Budgets | Navigation | Monats-/Jahresbudget je Kategorie, Ist vs. Soll | Fortschrittsbalken, Ampel | leer, im Limit, überschritten |
| S11 | Auswertungen | Navigation | Monats-/Jahresübersicht, Monatsvergleich, Kategorienanteile, Saldenverlauf, „Was bleibt am Monatsende“, Sparpotenzial | Diagramme, Zeitraumwahl, Tabellen | leer, gefüllt |
| S12 | Wiederkehrende Kosten | Navigation | erkannte und manuelle Fixkosten/Abos mit Turnus und Summe | Liste, Turnus, Jahressumme | erkannt, bestätigt |
| S13 | Belege / Dokumente | Navigation, aus Buchung | Belege (PDF/Bild) ablegen, an Buchungen hängen, suchen | Upload, Vorschau, Liste | leer, gefüllt |
| S14 | Import | Datei/Konto → Import | CSV-Kontoauszug einlesen, Spalten zuordnen, Dubletten erkennen | Assistent, Spaltenmapping, Vorschau | (eigene Ergänzung) |
| S15 | Einstellungen & Sicherheit | globales Menü | Passwortschutz/Verschlüsselung, Datensicherung/Wiederherstellung, Export | Formular | – |
| S16 | Steuervorschau | Block auf S02 | Summen steuerrelevanter Kategorien | Block | (siehe Out of scope) |

## Flows

```
F01 Ersteinrichtung
    S01 -> S02
    happy path clicks: ~4
    edge: Abbruch, leerer Name, Anfangssaldo negativ

F02 Ausgabe erfassen
    S05 -> S06 -> S05
    happy path clicks: ~5 (Ziel: 3 inkl. Enter)
    edge: Komma/Punkt-Dezimal, Datum in Zukunft, Betrag 0, Kategorie fehlt, sehr langer Text, Emoji/Umlaute

F03 Buchung aufteilen (Split)
    S05 -> S06 (Aufteilen) -> S05
    edge: Summe der Teile ≠ Gesamtbetrag, Rundung auf Cent

F04 Kontoauszug importieren (Ergänzung)
    S03 -> S14 (Datei, Mapping, Vorschau) -> S05
    edge: Sparkasse/ING/DKB-Formate, ISO-8859-1, Semikolon, Dubletten, Doppelimport

F05 Budget anlegen und prüfen
    S10 -> Budget-Dialog -> S10 / Block auf S02
    edge: Budget für Elternkategorie, Monatswechsel, Überschreitung

F06 Monatsauswertung ansehen
    S02 -> S11 (Zeitraum, Vergleich)
    edge: Monat ohne Daten, Umbuchungen dürfen nicht als Ausgabe zählen

F07 Wiederkehrende Kosten prüfen
    S12 (Vorschläge bestätigen/ablehnen)
    edge: schwankende Beträge, verschobene Tage, Kündigung

F08 Beleg zuordnen
    S06 oder S13 -> Datei wählen -> Verknüpfung
    edge: große Datei, falscher Typ

F09 Datensicherung und Wiederherstellung
    S15 -> Sicherung erstellen / einspielen
    edge: falsches Passwort, beschädigte Datei
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| App-Shell | Seitennavigation (Favoriten + Bereiche), Kopfzeile mit Schnellzugriff, Statusleiste | – | alle |
| Tabs | Modul-Reiter | aktiv, inaktiv | alle (Original: jedes Modul eigener Reiter) |
| Button | primär, sekundär, ghost, gefährlich | default, hover, focus, disabled, loading | alle |
| Betragsfeld | Einnahme, Ausgabe | gültig, Fehler | S04, S06, S07, S10 |
| Datumsfeld | – | – | S06, S11 |
| Kategorie-Picker | Baum mit Suche | – | S06, S09, S10 |
| Buchungstabelle | sortierbar, virtuell gescrollt | leer, gefüllt | S05 |
| Dashboard-Block | Diagramm, Liste, Kennzahl | leer, gefüllt | S02 |
| Diagramme | Linie, Balken, Donut, gestapelte Balken | leer | S02, S11 |
| Budget-Balken | im Limit, Warnung, überschritten | – | S02, S10 |
| Dialog/Modal | Formular, Bestätigung | – | viele |
| Toast/Statusmeldung | Info, Warnung, Fehler | – | alle |

## Inferred data model

```
Book (Haushaltsbuch/Datei)  id, name, currency(EUR), created_at
            evidence: S01 „Haushaltsbuch anlegen“   confidence: high

Account     id, name, type (cash | checking | household | credit | savings), owner, opening_balance, iban?, archived
            evidence: Schnelleinstieg Kontotyp/Name/Inhaber, Block „Meine Barmittel“   confidence: high

Transaction id, account_id, date, amount (Cent, signiert), payee, purpose, category_id?, note, transfer_account_id?, import_hash?, recurring_id?
            evidence: Formular Einnahme/Ausgabe (Konto, Empfänger/Auftraggeber)   confidence: high (Felder z. T. guess)

Split       id, transaction_id, category_id, amount, note
            evidence: „Buchungen aufsplitten“   confidence: high

Category    id, parent_id, name, kind (income | expense), tax_category?, color, icon
            evidence: Umkategorisieren, steuerkategorisierte Buchungen   confidence: high

Rule        id, field (payee|purpose|amount), op, value, category_id, priority
            evidence: „automatisch kategorisiert“   confidence: guess (Mechanik)

Budget      id, category_id, period (month|year), amount, start_month
            evidence: FAQ Budgets je Kategorie   confidence: high

Recurring   id, payee, category_id, amount, interval (monthly|quarterly|yearly), next_date, status (suggested|confirmed|ended)
            evidence: „wiederkehrende Kosten erkennen“   confidence: medium

Document    id, filename, mime, size, blob, created_at; DocumentLink(document_id, transaction_id)
            evidence: Dokumentenverwaltung, Belege digitalisieren   confidence: medium

DashboardBlock id, type, position, config(json)
            evidence: Startseiten-Blöcke, „Neuer Block“   confidence: high
```

Relationships: Book 1-n Account, Account 1-n Transaction, Transaction 1-n Split, Category 1-n Category (Baum), Category 1-n Budget, Recurring 1-n Transaction, Document n-m Transaction.

## Feature matrix

See `features.csv`. Must: 16, should: 12, could: 6, skip: 4.

## Out of scope (cannot or should not be cloned)

- Buhl-Informationscenter / Finanznachrichten (redaktioneller Inhalt des Anbieters)
- Steuervorschau mit echter Einkommensteuerberechnung (regelbasiert, gepflegte Steuertabellen; nur Summen je Steuerkategorie werden gebaut)
- Lizenz-/Aktivierungssystem, Updatedienst, Fernwartung, Support-Hotline
- Online-Banking per FinTS/HBCI (im Original-Haushaltsbuch nicht enthalten; regulierte Zugänge) – stattdessen CSV-Import

## Size

Screens 16, flows 9, entities 10. Hard parts: CSV-Import für verschiedene Bankformate inkl. Dubletten, Erkennung wiederkehrender Kosten, lokale Verschlüsselung + Backup, gute Diagramme. Size: M (einige Wochen für alle Must + Should).
