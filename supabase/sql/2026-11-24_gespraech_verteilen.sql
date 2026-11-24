-- Gesprächs-App „Mayer Gespräch“: eine Aufnahme auf mehrere Akten verteilen (24.11.2026).
-- Neue Spalte verteilung: Vorschlag der KI (Abschnitte je Kunde) und was je Akte angelegt wurde
-- (Schema Verteilung in supabase/functions/_shared/gespraechVerteilenKern.ts). Geschrieben nur vom Server
-- (email-gateway, Aktionen gespraech_verteilen_vorschlag / gespraech_verteilen).
-- gespraech_aufnahmen hat Spalten-Rechte für authenticated (SELECT je Spalte, kein Tabellen-SELECT): ohne den
-- GRANT unten bricht jedes Lesen mit select('…, verteilung') ab. Lesen genügt — der Browser schreibt die Spalte nie.
-- Wiederholbar.
alter table public.gespraech_aufnahmen add column if not exists verteilung jsonb;
comment on column public.gespraech_aufnahmen.verteilung is
  'Auf mehrere Akten verteilen: {version, status laeuft|fertig|fehler, seit, erstellt_am, von, fehler, hinweis, abschnitte[], ergebnisse{kunde_id: …}} — nur der Server schreibt.';
grant select (verteilung) on public.gespraech_aufnahmen to authenticated;
