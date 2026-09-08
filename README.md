# Mayer Holding CRM (Demo)

Klickbare CRM-Demo für die Mayer Holding – zwei Geschäftsbereiche (**Unternehmensberatung** und
**Immobilien**), jeweils mit eigenem Statusnetz, Kunden-/Objektlisten (Liste & Board), Detailseiten
mit Tabs, Mahnwesen, Rechnungen, Finanzierungen und Dokumentenstruktur.

Kein Backend: Alle Daten sind Mock-Daten (`src/data`), werden beim ersten Laden in `localStorage`
geseedet und danach von dort gelesen/geschrieben – Änderungen überleben einen Reload. Über den
Button „Daten zurücksetzen" in der Topbar lässt sich der Ursprungszustand wiederherstellen.

## Tech-Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- react-router-dom (`HashRouter`, damit die Demo ohne Server-Rewrites auf GitHub Pages läuft)
- lucide-react (Icons)
- State: React Context + `useReducer`, Persistenz via `localStorage`

## Lokal starten

```bash
npm install
npm run dev
```

Die App läuft danach unter `http://localhost:5173`.

## Build

```bash
npm run build
```

Erzeugt einen statischen Build in `dist/` (relative Pfade dank `base: './'` in `vite.config.ts`,
kompatibel mit GitHub Pages).

## Deployment

**Variante A – automatisch per GitHub Actions (empfohlen):**
Bei jedem Push auf `main` baut `.github/workflows/deploy.yml` das Projekt und veröffentlicht
`dist/` über GitHub Pages. Einmalig in den Repo-Einstellungen unter **Settings → Pages → Build and
deployment → Source** auf **„GitHub Actions"** stellen.

**Variante B – manuell per `gh-pages`-Paket:**

```bash
npm run deploy
```

Baut das Projekt und pusht `dist/` auf den Branch `gh-pages` (Paket `gh-pages` ist als Dev-Dependency
enthalten). In diesem Fall in den Pages-Einstellungen als Source den Branch `gh-pages` wählen.

## Projektstruktur

```
src/
  components/    UI-Bausteine (Layout, Sidebars, Statuswidget, Board, Modal, ...)
  context/       AppContext (Reducer + localStorage-Persistenz)
  data/          Mock-Daten, Statusnetze, Konstanten
  pages/
    beratung/    Kunden, Vorlagen, Mahnwesen, Rechnungen
    immobilien/  Objekte, Finanzierungen, Vorlagen
  types/         Zentrale TypeScript-Typen
```

## Statuslogik

Beide Bereiche nutzen ein typisiertes Statusnetz (`src/data/statusNetworks.ts`) mit erlaubten
Übergängen je Knoten. Das Statuswechsel-Widget zeigt nur erlaubte Folgestatus an; der Button
„Weiter →" wählt automatisch die nächste Station auf dem Hauptpfad. Jeder Wechsel wird in der
Aktivitäten-Timeline des Kunden/Objekts protokolliert.
