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
- Auswertungen: Monat, Jahr, Monatsvergleich, Langzeit
- Sicherung und Wiederherstellung als Datei, CSV-Export

## Aufbau

- `src/db/` ist der Datenlayer mit Schema, Repository und Auswertungen. Die UI greift nur darüber auf die Daten zu, damit sich später für eine Desktop-Version mit Tauri die Speicherung tauschen lässt.
- `src/pages/` enthält die Bildschirme, `src/components/` die gemeinsamen Bausteine.
- `replica/` enthält die Planung: Recon-Map, Feature-Matrix, Architektur und Design-Tokens.

Die App ist ein eigenständiger Neubau. Sie übernimmt keinen Code, keine Texte, Grafiken oder Marken anderer Hersteller.
