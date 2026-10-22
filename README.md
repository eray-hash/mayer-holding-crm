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

## E-Mail-Postfach-Anbindung (info@amayer-holding.com)

Die Edge Function `supabase/functions/email-gateway` verbindet das CRM mit dem echten IONOS-Postfach
(IMAP-Abruf + SMTP-Versand). Das echte Postfach-Passwort steht **nirgends im Code** — es wird nur als
Supabase-Secret hinterlegt, das Frontend bekommt lediglich die Function-URL + ein geteiltes Secret.

**Einmalige Einrichtung:**

1. Edge Function deployen (Supabase-Projekt `fundament-command-center`):
   ```bash
   npx supabase functions deploy email-gateway --project-ref gqumelldxrkxpjtnnotv --no-verify-jwt
   ```
2. Secrets setzen (im Supabase-Dashboard unter **Edge Functions → email-gateway → Secrets**, oder per
   CLI — **das eigentliche Postfach-Passwort wird nur hier eingetragen, nie im Chat/Code**):
   - `IMAP_HOST` = `imap.ionos.de`, `IMAP_PORT` = `993`
   - `IMAP_USER` = `info@amayer-holding.com`, `IMAP_PASSWORD` = *(echtes Postfach-Passwort)*
   - `SMTP_HOST` = `smtp.ionos.de`, `SMTP_PORT` = `587`
   - `SMTP_USER` = `info@amayer-holding.com`, `SMTP_PASSWORD` = *(gleiches oder separates Passwort)*
   - `CRM_SHARED_SECRET` = *(ein selbst gewähltes, beliebiges langes Zufalls-Secret)*
3. Function-URL (`supabase functions list` bzw. Dashboard) und das gleiche `CRM_SHARED_SECRET` in
   `.env.local` eintragen (siehe `.env.example`):
   ```bash
   VITE_EMAIL_GATEWAY_URL=https://<project-ref>.supabase.co/functions/v1/email-gateway
   VITE_EMAIL_GATEWAY_SECRET=<gleiches Secret wie CRM_SHARED_SECRET>
   ```
4. Für die live auf GitHub Pages deployte Version dieselben beiden Variablen zusätzlich unter
   **Repo-Settings → Secrets and variables → Actions** als Repository-Secrets (`VITE_EMAIL_GATEWAY_URL`,
   `VITE_EMAIL_GATEWAY_SECRET`) hinterlegen — der Build-Workflow (`.github/workflows/deploy.yml`) reicht
   sie bereits automatisch an `npm run build` durch (genau wie `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`,
   für die dasselbe gilt, falls das CRM später auf die echte Datenbank umgestellt wird).

Ohne diese Konfiguration zeigt der „Postfach"-Button im CRM transparent „noch nicht verbunden" an —
es wird nichts vorgetäuscht.

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

## Investoren-Portal (Investitionsfonds 2026)

Zusätzlich zur internen CRM-Ansicht gibt es unter `#/portal/login` einen separaten, kundenseitigen
Bereich für den AMH Investitionsfonds 2026 (eigenes Layout, eigener Login, kein Zugriff auf die
interne Sidebar). Investoren sehen dort ihre Zeichnungen, die Wertentwicklung entlang des
Zielrenditepfads, geplante/ausgezahlte Ausschüttungen und ihre Dokumente.

- Daten: `src/data/seedFonds.ts` (Mock-Investoren), Renditepfad/Berechnung in `src/lib/fonds.ts`
- Auth: rein clientseitiger Demo-Login per E-Mail-Abgleich (`src/context/PortalAuthContext.tsx`),
  kein echtes Backend – auf der Login-Seite stehen Demo-Zugänge zum Ein-Klick-Übernehmen bereit
- Von der internen CRM-Ansicht gelangt man über den Button „Kundenportal (Demo)" in der Topbar dorthin

## Statuslogik

Beide Bereiche nutzen ein typisiertes Statusnetz (`src/data/statusNetworks.ts`) mit erlaubten
Übergängen je Knoten. Das Statuswechsel-Widget zeigt nur erlaubte Folgestatus an; der Button
„Weiter →" wählt automatisch die nächste Station auf dem Hauptpfad. Jeder Wechsel wird in der
Aktivitäten-Timeline des Kunden/Objekts protokolliert.
