# Modul „E-Rechnung“ (XRechnung / ZUGFeRD)

Zusatzmodul, seit 23.11.2026. Es lässt sich jederzeit aus- und wieder einschalten und ohne Rückstände ganz entfernen.

## Was das Modul kann

1. **E-Rechnung einlesen** (Seite *Verbindlichkeiten*, Knopf „E-Rechnung einlesen“ oben rechts):
   Eine XRechnung (`.xml`) oder eine ZUGFeRD-/Factur-X-PDF wählen. Die Angaben stehen maschinenlesbar in der
   Datei und werden ohne KI genau ausgelesen. Eine Vorschau zeigt Lieferant, Rechnungsnummer, Datum, Fälligkeit,
   netto/Steuer/brutto, IBAN und Positionen; bei einer Gutschrift erscheint ein deutlicher Hinweis.
   „Übernehmen“ legt eine Verbindlichkeit an (von Hand angelegt, gleich als geprüft markiert, Notiz mit Kurzbeschreibung)
   und speichert die Datei als Beleg. Gibt es schon eine Verbindlichkeit mit gleichem Lieferanten und gleicher
   Rechnungsnummer, wird gewarnt und nichts doppelt angelegt. Enthält die Datei keine E-Rechnung, sagt eine Meldung das.
2. **E-Rechnung erzeugen** (Detailfenster einer Ausgangsrechnung, Knopf „E-Rechnung (XRechnung)“):
   Erstellt aus Rechnung, Akte des Kunden und Briefkopf eine XRechnung 3.0 und speichert sie als
   `<Nummer>_XRechnung.xml`. Fehlen Pflichtangaben (z. B. E-Mail-Adresse oder Postleitzahl des Kunden), erscheint
   eine Liste, was fehlt.
3. **Rechnungsversand per E-Mail** (Fenster „Rechnung senden“): Ist eine XRechnung möglich, wird sie zusätzlich zum
   PDF angehängt. Sonst geht nur das PDF hinaus, und das Fenster zeigt kurz, warum.

Ein- und ausschalten: *Profil & Einstellungen* → Abschnitt „Zusatzmodule“ (nur die Geschäftsführung darf schalten).
Ausgeschaltet verschwinden alle Knöpfe und Hinweise; angelegte Verbindlichkeiten und Belege bleiben erhalten.

## Wo der Code liegt

- `src/module/eRechnung/` — alle Bausteine der Oberfläche:
  - `kern.ts` reicht das Lesen und Erzeugen aus `supabase/functions/_shared/eRechnung/` weiter (gleicher Code für Browser und Server, dort auch die Tests),
  - `ERechnungEinlesen.tsx` Knopf, Vorschau und Übernahme auf der Seite Verbindlichkeiten,
  - `XRechnungKnopf.tsx` Knopf im Detailfenster einer Rechnung,
  - `ausRechnung.ts` stellt aus einer Rechnung die Angaben für die XRechnung zusammen (auch für den Versand),
  - `ERechnungVersandHinweis.tsx` Hinweis im Fenster „Rechnung senden“.
- `src/module/modulSchalter.ts` und `src/module/ZusatzModule.tsx` — allgemeiner Modul-Schalter (Tabelle `crm_module`), nicht nur für dieses Modul.

## Modul entfernen

1. Den Ordner `src/module/eRechnung/` löschen.
2. In den bestehenden Dateien alle Zeilen entfernen, die mit
   `// Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md)` markiert sind
   (Suche nach `Modul E-Rechnung (abschaltbar`):
   - `src/pages/beratung/Verbindlichkeiten.tsx` — Einbindung und Knopf „E-Rechnung einlesen“,
   - `src/components/rechnungen/RechnungDetail.tsx` — Einbindung und Knopf „E-Rechnung (XRechnung)“,
   - `src/components/rechnungen/RechnungDialoge.tsx` — Einbindungen, `useXRechnungFuerVersand`, `weitereAnhaenge=…` und der Hinweis,
   - `src/components/rechnungen/PdfVersandModal.tsx` und `src/components/rechnungen/aktionen.ts` — die allgemeine
     Möglichkeit `weitereAnhaenge` (darf auch bleiben; ohne Aufrufer ändert sie nichts).
3. Die Zeile in der Datenbank löschen: `delete from crm_module where id = 'e_rechnung';`
4. Wer die E-Rechnung auch auf dem Server nicht mehr braucht: `supabase/functions/_shared/eRechnung/` löschen
   (vorher prüfen, dass keine Edge Function mehr daraus liest — Stand 23.11.2026 nutzt z. B.
   `supabase/functions/email-gateway/belegErgaenzen.ts` das Lesen).
5. Prüfen: `npx tsc -b` und `npx vite build`.

Den allgemeinen Modul-Schalter (`modulSchalter.ts`, `ZusatzModule.tsx`, Abschnitt in `src/pages/profil/MeinProfil.tsx`
und die Tabelle `crm_module`) nur entfernen, wenn es gar keine Zusatzmodule mehr gibt.
