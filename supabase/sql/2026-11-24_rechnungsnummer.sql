-- Rechnungsnummern nach Vorgabe der Geschäftsführung (24.11.2026) — NICHT automatisch ausführen.
-- Wiederholbar (if not exists / or replace). Logik: supabase/functions/_shared/rechnungsnummerKern.ts.
--
-- Schema: <Initialen><Unterscheidung>-<laufende Nummer je Kunde>, z. B. LSA-001. Die Unterscheidung (A, B, … Z, AA …)
-- wird dem Kunden einmal fest zugeteilt und hier gespeichert. Alte Rechnungen (z. B. CL-001) bleiben unverändert.
--
-- Vor dem Ausführen dieser Datei lehnt der Assistent (rechnung_erstellen) das Ausstellen mit einem Hinweis ab, und
-- das Rechnungsformular im CRM schlägt weiter die alte Nummer (RE-JJJJ-NNN) vor.

-- 1) Kürzel am Kunden, z. B. 'LSA' (nur Großbuchstaben A–Z, 3 bis 8 Zeichen).
alter table public.kunden add column if not exists rechnungs_kuerzel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kunden_rechnungs_kuerzel_form') then
    alter table public.kunden add constraint kunden_rechnungs_kuerzel_form
      check (rechnungs_kuerzel is null or rechnungs_kuerzel ~ '^[A-Z]{3,8}$');
  end if;
end $$;

-- 2) Eindeutig: zwei Kunden können nie dasselbe Kürzel bekommen, auch nicht bei gleichzeitiger Vergabe
--    (der zweite Versuch scheitert mit 23505 und rechnet neu).
create unique index if not exists kunden_rechnungs_kuerzel_eindeutig on public.kunden (rechnungs_kuerzel) where rechnungs_kuerzel is not null;

-- 3) Einmal vergeben, nie mehr ändern: Ein Speichern aus dem CRM oder ein Zusammenführen kann das Kürzel weder
--    überschreiben noch leeren (der alte Wert bleibt stillschweigend stehen).
create or replace function public.kunden_rechnungs_kuerzel_fest()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.rechnungs_kuerzel is not null and new.rechnungs_kuerzel is distinct from old.rechnungs_kuerzel then
    new.rechnungs_kuerzel := old.rechnungs_kuerzel;
  end if;
  return new;
end $$;

drop trigger if exists kunden_rechnungs_kuerzel_fest on public.kunden;
create trigger kunden_rechnungs_kuerzel_fest
  before update of rechnungs_kuerzel on public.kunden
  for each row execute function public.kunden_rechnungs_kuerzel_fest();

comment on column public.kunden.rechnungs_kuerzel is
  'Fest zugeteiltes Kürzel für Rechnungsnummern (Initialen + Unterscheidungsbuchstabe, z. B. LSA → LSA-001). Einmal gesetzt, unveränderlich.';

-- Die laufende Nummer braucht nichts Neues: rechnungen.nummer ist schon eindeutig
-- (Index rechnungen_nummer_eindeutig auf lower(btrim(nummer))). Wer bei gleichzeitiger Vergabe verliert, nimmt die nächste.
-- Die Tabelle kunden ist für angemeldete Mitarbeiter als Ganzes freigegeben (kein Spalten-GRANT nötig).
