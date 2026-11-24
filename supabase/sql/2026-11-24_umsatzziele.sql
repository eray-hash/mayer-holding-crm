-- Umsatzziele je Monat und Sparte (24.11.2026, Wunsch der Geschäftsführung: Andreas, Hasan, Eray).
-- Monatsziel 50.000 € netto: KI 10.000 €, Immobilien 15.000 €, Beratung & Privat 25.000 €. Am Monatsanfang gilt
-- automatisch die Vorgabe der Sparte (umsatz_sparten.soll_vorgabe), die Geschäftsführung kann das Soll je Monat
-- ändern. Gerechnet wird in supabase/functions/_shared/umsatzZielKern.ts (Seite /ziele, Karte „Unser Ziel“ in
-- jeder Abteilung, Abschnitt in der Morgen-Übersicht, Assistent-Werkzeug umsatzziel_stand).
--
-- Rechte: Lesen dürfen alle aktiven Mitarbeiter, Schreiben nur Geschäftsführung/Admin (ist_geschaeftsfuehrung)
-- und Superuser — wie die anderen Einstellungs-Tabellen (crm_module). Die Schalter-Zeile umsatz_ziel_einstellung
-- schreibt nur der Server (Seite „Automatische Nachrichten“, Aktion automatik_schalter).
-- Wiederholbar.

-- ── Sparten: welche Umsätze zählen wozu ─────────────────────────────────────────────────────────────────────
create table if not exists public.umsatz_sparten (
  id text primary key,                                   -- feste Kennung: 'ki' | 'immobilien' | 'beratung'
  name text not null,
  reihenfolge integer not null default 0,
  soll_vorgabe numeric not null default 0 check (soll_vorgabe >= 0),   -- Soll netto je Monat, wenn nichts anderes eingetragen ist
  bereiche text[] not null default '{}',                 -- Akten-Bereiche (kunden.bereich), deren Umsatz hierher zählt
  stichwoerter text[] not null default '{}',             -- Stichwörter in Rechnungspositionen / Angeboten (nur mit stichwort_aktiv)
  stichwort_aktiv boolean not null default false,        -- Stichwort-Erkennung aus allen Bereichen (Vorgabe aus)
  objekt_provision boolean not null default false,       -- Provisionen aus Objekten (Immobilien) zählen hierher
  rest boolean not null default false,                   -- alles, was keine andere Sparte nimmt
  geaendert_von text,
  geaendert_am timestamptz not null default now()
);
comment on table public.umsatz_sparten is
  'Sparten der Umsatzziele mit Zuordnung (Bereiche, Stichwörter, Objekt-Provision, Rest) — Regeln in _shared/umsatzZielKern.ts.';

-- Vorbelegung (nur, wo noch nichts steht — vorhandene Änderungen bleiben):
--   KI: eigener Bereich 'ki' (kommt bald als eigener Bereich ins CRM, gibt es noch nicht → Ist 0 mit Hinweis).
--       Stichwörter „KI“/„künstliche Intelligenz“ nur als zusätzliche Option, Vorgabe AUS (sonst zählten z. B.
--       KI-Manager-Seminare der Akademie hier statt bei Beratung & Privat).
--   Immobilien: Bereich immobilienkunden + Provisionen aus Objekten.
--   Beratung & Privat: alles andere (Unternehmensberatung, Erben, Betriebsübergabe, Betriebsformen, Akademie,
--       Finanzierungen, Bücher, Rechnungen ohne Akte).
insert into public.umsatz_sparten (id, name, reihenfolge, soll_vorgabe, bereiche, stichwoerter, stichwort_aktiv, objekt_provision, rest, geaendert_von)
values
  ('ki', 'KI', 1, 10000, array['ki'], array['KI', 'künstliche Intelligenz'], false, false, false, 'Vorgabe'),
  ('immobilien', 'Immobilien', 2, 15000, array['immobilienkunden'], '{}', false, true, false, 'Vorgabe'),
  ('beratung', 'Beratung & Privat', 3, 25000, array['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'buecher'], '{}', false, false, true, 'Vorgabe')
on conflict (id) do nothing;

-- ── Soll je Monat und Sparte ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.umsatz_ziele (
  monat text not null check (monat ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sparte text not null references public.umsatz_sparten(id) on update cascade on delete cascade,
  soll_netto numeric not null check (soll_netto >= 0),
  geaendert_von text,
  geaendert_am timestamptz not null default now(),
  primary key (monat, sparte)
);
comment on table public.umsatz_ziele is
  'Soll netto je Monat (JJJJ-MM) und Sparte. Fehlt eine Zeile, gilt umsatz_sparten.soll_vorgabe (der Server trägt sie am Monatsanfang ein).';

-- ── Schalter: Umsatzziel in der Morgen-Übersicht der Geschäftsführung (Vorgabe AUS) ─────────────────────────
create table if not exists public.umsatz_ziel_einstellung (
  id integer primary key default 1 check (id = 1),
  meldung_aktiv boolean not null default false,
  geaendert_von text,
  geaendert_am timestamptz
);
insert into public.umsatz_ziel_einstellung (id, meldung_aktiv) values (1, false) on conflict (id) do nothing;

-- ── Zeilenregeln ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.umsatz_sparten enable row level security;
alter table public.umsatz_ziele enable row level security;
alter table public.umsatz_ziel_einstellung enable row level security;

drop policy if exists "umsatz_sparten lesen" on public.umsatz_sparten;
create policy "umsatz_sparten lesen" on public.umsatz_sparten for select to authenticated using (ist_aktiver_mitarbeiter());
drop policy if exists "umsatz_sparten aendern" on public.umsatz_sparten;
create policy "umsatz_sparten aendern" on public.umsatz_sparten for update to authenticated
  using (ist_geschaeftsfuehrung() or ist_superuser()) with check (ist_geschaeftsfuehrung() or ist_superuser());

drop policy if exists "umsatz_ziele lesen" on public.umsatz_ziele;
create policy "umsatz_ziele lesen" on public.umsatz_ziele for select to authenticated using (ist_aktiver_mitarbeiter());
drop policy if exists "umsatz_ziele anlegen" on public.umsatz_ziele;
create policy "umsatz_ziele anlegen" on public.umsatz_ziele for insert to authenticated
  with check (ist_geschaeftsfuehrung() or ist_superuser());
drop policy if exists "umsatz_ziele aendern" on public.umsatz_ziele;
create policy "umsatz_ziele aendern" on public.umsatz_ziele for update to authenticated
  using (ist_geschaeftsfuehrung() or ist_superuser()) with check (ist_geschaeftsfuehrung() or ist_superuser());
drop policy if exists "umsatz_ziele loeschen" on public.umsatz_ziele;
create policy "umsatz_ziele loeschen" on public.umsatz_ziele for delete to authenticated
  using (ist_geschaeftsfuehrung() or ist_superuser());

drop policy if exists "umsatz_ziel_einstellung lesen" on public.umsatz_ziel_einstellung;
create policy "umsatz_ziel_einstellung lesen" on public.umsatz_ziel_einstellung for select to authenticated using (ist_aktiver_mitarbeiter());
-- Schreiben nur der Server (Dienstschlüssel, automatik_schalter).

grant select, update on public.umsatz_sparten to authenticated;
grant select, insert, update, delete on public.umsatz_ziele to authenticated;
grant select on public.umsatz_ziel_einstellung to authenticated;
