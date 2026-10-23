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

## E-Mail-Versand (info@amayer-holding.com)

Die Edge Function `supabase/functions/email-gateway` verbindet das CRM mit dem echten IONOS-Postfach
für **Versand** (SMTP) und die **KI-Gesprächszusammenfassung**. Das echte Postfach-Passwort steht
**nirgends im Code** — es wird nur als Supabase-Secret hinterlegt, das Frontend bekommt lediglich die
Function-URL + ein geteiltes Secret.

> **Hinweis zum Posteingang:** Der direkte IMAP-Abruf (`action: "sync"` in dieser Function) ist
> technisch nicht nutzbar — Port 993 wird von der Supabase-Edge-Function-Laufzeit blockiert, Port 143
> scheitert an einem STARTTLS-Kompatibilitätsproblem der `imapflow`-Bibliothek unter Deno (beides
> live getestet, 22./23.10.2026). Der Posteingang läuft stattdessen über einen Webhook — siehe
> nächster Abschnitt "Posteingang über Webhook".

**Einmalige Einrichtung:**

1. Edge Function deployen (eigenes Supabase-Projekt `mayer-holding-crm`, Projekt-Ref
   `qyqtxltwgetliddwceox` — bewusst getrennt von `fundament-command-center`, da der dortige Account
   keinen Zugriff auf dieses Projekt hat):
   ```bash
   npx supabase functions deploy email-gateway --project-ref qyqtxltwgetliddwceox --no-verify-jwt
   ```
2. Secrets setzen (im Supabase-Dashboard unter **Edge Functions → email-gateway → Secrets**, oder per
   CLI — **das eigentliche Postfach-Passwort wird nur hier eingetragen, nie im Chat/Code**):
   - `IMAP_HOST` = `imap.ionos.de`, `IMAP_PORT` = `143` (nur für den—aktuell nicht funktionierenden—Sync)
   - `IMAP_USER` = `info@amayer-holding.com`, `IMAP_PASSWORD` = *(echtes Postfach-Passwort)*
   - `SMTP_HOST` = `smtp.ionos.de`, `SMTP_PORT` = `587`
   - `SMTP_USER` = `info@amayer-holding.com`, `SMTP_PASSWORD` = *(gleiches oder separates Passwort)*
   - `CRM_SHARED_SECRET` = *(ein selbst gewähltes, beliebiges langes Zufalls-Secret)*
   - `ANTHROPIC_API_KEY` = *(eigener Anthropic-API-Key, für die KI-Gesprächszusammenfassung — siehe
     Abschnitt "Gespräch aufzeichnen" unten; ohne diesen Key funktioniert Versand trotzdem, nur
     "Mit KI zusammenfassen" zeigt dann einen Hinweis statt eines Ergebnisses)
3. Function-URL (`supabase functions list` bzw. Dashboard) und das gleiche `CRM_SHARED_SECRET` in
   `.env.local` eintragen (siehe `.env.example`):
   ```bash
   VITE_EMAIL_GATEWAY_URL=https://qyqtxltwgetliddwceox.supabase.co/functions/v1/email-gateway
   VITE_EMAIL_GATEWAY_SECRET=<gleiches Secret wie CRM_SHARED_SECRET>
   ```
4. Für die live auf GitHub Pages deployte Version dieselben beiden Variablen zusätzlich unter
   **Repo-Settings → Secrets and variables → Actions** als Repository-Secrets (`VITE_EMAIL_GATEWAY_URL`,
   `VITE_EMAIL_GATEWAY_SECRET`) hinterlegen — der Build-Workflow (`.github/workflows/deploy.yml`) reicht
   sie bereits automatisch an `npm run build` durch (genau wie `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`,
   für die dasselbe gilt, falls das CRM später auf die echte Datenbank umgestellt wird).

Ohne diese Konfiguration zeigt der „E-Mail senden"-Button im CRM transparent „noch nicht verbunden"
an — es wird nichts vorgetäuscht.

## Posteingang über Webhook (statt IMAP)

Eingehende E-Mails an info@amayer-holding.com landen über eine **Weiterleitungsregel in IONOS** bei
einem externen Inbound-Email-Webhook-Dienst (z. B. [CloudMailin](https://www.cloudmailin.com/)), der
jede E-Mail als HTTP-POST an die Edge Function `supabase/functions/inbound-email` schickt. Diese
schreibt sie in die Tabelle `public.eingegangene_emails` (im selben `mayer-holding-crm`-Projekt); das
CRM-Frontend liest diese Tabelle direkt per Supabase-Client (nur Lesezugriff, RLS-Policy "allow read
for all"). Kein IMAP nötig — nur normale HTTPS-Webhooks, die in der Edge-Function-Umgebung
nachweislich funktionieren.

**Einmalige Einrichtung:**

1. Tabelle `public.eingegangene_emails` + Lese-Policy sind bereits angelegt (siehe Migration unten,
   zur Nachvollziehbarkeit — wurde direkt im SQL-Editor ausgeführt, nicht per CLI-Migration):
   ```sql
   create table if not exists public.eingegangene_emails (
     id uuid primary key default gen_random_uuid(),
     message_id text, von text not null, von_name text, betreff text,
     mail_datum timestamptz not null default now(), ausschnitt text,
     rohdaten jsonb, erstellt_am timestamptz not null default now()
   );
   alter table public.eingegangene_emails enable row level security;
   create policy "allow read for all" on public.eingegangene_emails for select using (true);
   ```
2. Function deployen:
   ```bash
   npx supabase functions deploy inbound-email --project-ref qyqtxltwgetliddwceox --no-verify-jwt
   ```
3. Secret setzen (frei erfundenes Secret, schützt den öffentlichen Webhook-Endpunkt vor Fremdzugriff
   — `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` sind in jeder Edge Function bereits automatisch
   vorhanden, müssen nicht gesetzt werden):
   ```bash
   npx supabase secrets set --project-ref qyqtxltwgetliddwceox INBOUND_SECRET=<frei gewähltes Secret>
   ```
4. Bei CloudMailin (oder einem anderen Anbieter) einen kostenlosen Account anlegen, eine neue
   Adresse/Ziel anlegen mit **Target URL**:
   ```
   https://qyqtxltwgetliddwceox.supabase.co/functions/v1/inbound-email?secret=<gleiches INBOUND_SECRET>
   ```
5. In IONOS beim Postfach `info@amayer-holding.com` eine **Weiterleitung** auf die von CloudMailin
   vergebene Adresse einrichten, **"Kopie im Posteingang behalten"** aktivieren (keine Änderung an
   MX-Records der Domain nötig — betrifft nur dieses eine Postfach, die anderen drei
   `amayer-holding.com`-Postfächer bleiben unberührt).
6. Projekt-URL + Publishable Key dieses Supabase-Projekts (Project Settings → API Keys) in
   `.env.local` eintragen (siehe `.env.example`) und als Repository-Secrets für den Live-Build
   hinterlegen:
   ```bash
   VITE_SUPABASE_EMAIL_URL=https://qyqtxltwgetliddwceox.supabase.co
   VITE_SUPABASE_EMAIL_ANON_KEY=<Publishable Key aus dem Dashboard>
   ```

Ohne diese Konfiguration zeigt der "Postfach"-Button im CRM transparent „Posteingang noch nicht
verbunden" an.

## Postfach-Seite (Ordnerstruktur, Gesendet, Mailvorlagen)

Das Postfach (`#/postfach`, eigene Seite statt Modal) zeigt zwei Ordner — **Posteingang** (siehe
oben) und **Gesendet**. Jede über "E-Mail senden"/"Neue E-Mail" verschickte Mail wird vom
`email-gateway` nach erfolgreichem SMTP-Versand zusätzlich in `public.gesendete_emails` geschrieben
(gleiche Lese-Policy wie `eingegangene_emails`):

```sql
create table if not exists public.gesendete_emails (
  id uuid primary key default gen_random_uuid(),
  an text not null, an_name text, betreff text, text text,
  kunde_bereich text, kunde_id text, kunde_name text,
  gesendet_am timestamptz not null default now()
);
alter table public.gesendete_emails enable row level security;
create policy "allow read for all" on public.gesendete_emails for select using (true);
```

**Mailvorlagen** (Betreff + Text mit Platzhaltern `{{firma}}`/`{{ansprechpartner}}`) sind rein
lokale CRM-Daten (wie die bestehenden Dokumentvorlagen), verwaltbar über "Mailvorlagen verwalten" im
Postfach. Beim Versenden aus einer Kundenakte werden die Platzhalter automatisch durch die
Kundendaten ersetzt; beim freien Verfassen im Postfach bleiben sie sichtbar stehen.

### Bestehende, alte E-Mails nachträglich importieren

Die IONOS-Weiterleitung erfasst nur E-Mails, die **nach** ihrer Einrichtung eintreffen — ältere,
bereits im Postfach liegende Mails landen dadurch nicht automatisch in `eingegangene_emails`. Dafür
gibt es ein einmaliges lokales Migrations-Skript (`scripts/migrate-inbox.mjs`), das die bestehenden
Mails per IMAP ausliest (funktioniert normal von einem Rechner aus, nur nicht aus der
Supabase-Edge-Function-Laufzeit heraus) und per `message_id`-Upsert in dieselbe Tabelle schreibt, die
auch der Webhook befüllt — bereits vom Webhook erfasste Mails werden dabei übersprungen statt
dupliziert.

```bash
IMAP_USER=info@amayer-holding.com \
IMAP_PASSWORD='<echtes Postfach-Passwort>' \
SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='<Service-Role-Key aus Project Settings → API Keys>' \
npm run migrate-inbox
```

Optional: `IMAP_LIMIT=100` begrenzt den Import auf die letzten N Mails statt aller. Das Skript ist
rein lokal/einmalig gedacht, nicht Teil von CI/CD. Es verfolgt die zuletzt verarbeitete UID und
verbindet bei einem Verbindungsabbruch (IONOS beendet lang laufende IMAP-Sessions von sich aus)
automatisch bis zu 8x neu.

### Posteingang aufräumen (Newsletter/Werbung/Belege entfernen)

Ein per IMAP importiertes Postfach enthält typischerweise sehr viel Nicht-Kunden-Korrespondenz
(Newsletter, Zahlungsbelege, Lead-Marktplätze, Abo-Dienste). `scripts/cleanup-inbox.mjs` klassifiziert
jede Mail in `eingegangene_emails` per Anthropic-API als „Kunde/Interessent" oder „nicht relevant" und
löscht Letztere. Läuft standardmäßig als **Dry Run** — zeigt nur an, was gelöscht würde, und schreibt
die vollständige Liste zur Durchsicht nach `scripts/cleanup-inbox-report.json` (lokal, nicht
eingecheckt). Erst mit `CONFIRM_DELETE=yes` wird tatsächlich gelöscht.

```bash
# 1. Dry Run — zeigt nur an, was gelöscht würde
SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='<Service-Role-Key>' \
ANTHROPIC_API_KEY='<eigener Anthropic-API-Key>' \
npm run cleanup-inbox

# 2. Report in scripts/cleanup-inbox-report.json prüfen, dann tatsächlich löschen:
SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='<Service-Role-Key>' \
ANTHROPIC_API_KEY='<eigener Anthropic-API-Key>' \
CONFIRM_DELETE=yes \
npm run cleanup-inbox
```

## Gespräch aufzeichnen + KI-Zusammenfassung

In der Gesprächsprotokolle-Tab eines Kunden (Beratung) kann ein Telefonat live transkribiert werden
(Web-Speech-API, mit manuell editierbarem Fallback-Textfeld). Über „Mit KI zusammenfassen" wird das
Transkript an dieselbe `email-gateway`-Function geschickt (`action: "summarize"`), die über die
Anthropic-API eine strukturierte Zusammenfassung erzeugt: Kernthemen, Vereinbarungen, offene Punkte,
Stimmung, Fließtext-Zusammenfassung — alle Felder bleiben vor dem Speichern editierbar. Braucht
zusätzlich zu den Secrets oben nur `ANTHROPIC_API_KEY` als weiteres Supabase-Secret (siehe oben) —
kein zweites Deployment, keine weiteren Frontend-Variablen nötig.

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
