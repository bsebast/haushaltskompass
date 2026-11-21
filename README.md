# Haushaltskompass

Ein lokales Haushaltsbuch: Konten, Buchungen, Kategorien, Regeln, Budgets und Auswertungen. Alle Daten bleiben auf deinem Gerät. Die App läuft im Browser, und alles wird in einer SQLite-Datenbank im Browser-Speicher abgelegt. Es gibt keinen Server und kein Konto.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Tests für den Datenlayer
npm run build      # statischer Build in dist/
```

## Funktionen (Stand 0.1)

- Einrichtungsassistent, Beispieldaten zum Ausprobieren
- Konten (Giro, Bargeld, Haushaltskasse, Kreditkarte, Sparkonto) mit Anfangssaldo und Archiv
- Ausgaben, Einnahmen und Umbuchungen; Buchungen aufteilen; pauschale Erfassung
- Taste **N** öffnet überall die Erfassung einer neuen Buchung
- Suche über Empfänger, Zweck, Kategorie und Betrag; Filter nach Konto, Zeitraum, Art und Kategorie; Sammel-Kategorisierung
- Kategoriebaum mit Standardkategorien, Farben und optionaler Steuerkategorie
- Regeln zur automatischen Kategorisierung mit Trefferanzeige
- Budgets je Kategorie (monatlich oder jährlich) mit Ampel und Prognose
- Übersicht: Monatsrest mit Hochrechnung, Konten, Budgets, Saldenverlauf, Kategorien, Sparpotenzial
- Auswertungen: Monat, Jahr, Monatsvergleich, Langzeit. Ein Klick auf einen Betrag, Balken, Tortenstück oder Punkt zeigt die Buchungen dahinter
- Verträge & Fixkosten: Rhythmus, Fälligkeit, Person, Ø pro Monat, CSV-Import (Spalten wie Vertrag; Vertragspartner; Zweck; Betrag; Rhythmus; Fälligkeit; Zahlart; Art; Kategorie; Bemerkung)
- Konten nach Person mit Bank, Zinssatz und Freistellungsauftrag; Kontoarten auch Depot, Festgeld, Kredit
- Kontostände zu Stichtagen (für Depots und Konten ohne Einzelbuchungen) und Vermögensverlauf
- Vermögen: Depotpositionen mit Einstand, Kurswert und Gewinn
- Vorsorge: Renten und Versicherungen mit Einmalbetrag, Monatsrente und Hochrechnungen
- Prognose: voraussichtlicher Kontostand der nächsten 6 bis 60 Monate aus dem Durchschnitt der letzten Monate, Verträge im Fälligkeitsmonat, große Einzelausgaben herausgerechnet, mit Szenarien (einmalig, monatlich, prozentual) und Warngrenze
- Geldfluss (Auswertungen → Geldfluss): Flussdiagramm von den Einnahmen über das verfügbare Geld zu Ausgaben, Sparen und Überschuss, Klick zeigt die Buchungen
- Inventar: Wertgegenstände mit Kaufpreis, Zeitwert (von Hand oder linear über die Nutzungsdauer), Garantie, Versicherung und Beleg (Bild/PDF im Haushaltsbuch), CSV und Druck; Zeitwert optional im Vermögen
- Warngrenzen: Unter- und Obergrenze je Konto, Kursgrenzen je Depotposition (Glocke unter Vermögen); die Übersicht zeigt Hinweise, auch zu bald endenden Garantien
- Gesamtimport (Einstellungen → Daten importieren) im Format `haushaltskompass-import` (JSON, siehe `src/db/importer.ts`)
- Sicherung und Wiederherstellung als Datei, CSV-Export
- Bankabruf per FinTS (Buchungen → Bankabruf), siehe unten

## Bankabruf per FinTS

Mit „Bankabruf“ holt die App gebuchte Umsätze direkt von der Bank, voreingestellt sind Volksbanken/Raiffeisenbanken (Atruvia), comdirect und ING. Weitere FinTS-Banken lassen sich unter „Andere Bank“ mit BLZ und FinTS-Adresse eintragen. Die Umsätze laufen durch dieselbe Vorschau wie der Dateiimport: Dubletten werden erkannt (auch gegenüber früheren Dateiimporten, über Buchungstag und Betrag), Regeln und Verträge vergeben Kategorien, Umbuchungen bekommen ihre Gegenbuchung.

- Der FinTS-Dialog läuft in einem kleinen Dienst im Dev-Server (`vite-plugin-fints.ts`, Bibliothek `lib-fints`), weil Browser Bankserver nicht direkt ansprechen dürfen. Er läuft also nur mit `npm run dev`.
- Voraussetzung ist eine FinTS-Produktnummer der Deutschen Kreditwirtschaft (kostenlose Registrierung unter fints.org → Hersteller → Produktregistrierung). Sie wird beim ersten Bankabruf in der App eingegeben und in `privat/fints/fints.json` gespeichert, alternativ über die Umgebungsvariable `HK_FINTS_PRODUKT_ID`.
- PIN und TAN werden nur für die laufende Verbindung im Speicher gehalten und nie gespeichert oder protokolliert. In `privat/fints/` (nicht im Git) liegen nur die Bankparameter mit der Kundensystem-ID und auf Wunsch der Anmeldename.
- TAN-Verfahren mit Freigabe in der App (SecureGo plus, photoTAN-Push, ING-App) werden automatisch abgefragt; TAN-Eingabe und photoTAN-Grafik werden ebenfalls unterstützt, chipTAN optisch nicht.

## Aufbau

- `src/db/` ist der Datenlayer mit Schema, Repository und Auswertungen. Die UI greift nur darüber auf die Daten zu, damit sich später für eine Desktop-Version mit Tauri die Speicherung tauschen lässt.
- `src/pages/` enthält die Bildschirme, `src/components/` die gemeinsamen Bausteine.
- `replica/` enthält die Planung: Recon-Map, Feature-Matrix, Architektur und Design-Tokens.

Die App ist ein eigenständiger Neubau. Sie übernimmt keinen Code, keine Texte, Grafiken oder Marken anderer Hersteller.
