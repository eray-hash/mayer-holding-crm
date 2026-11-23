-- Runde 6 (23.11.2026): Bereichspostfach Immobilien (immo@amayer-holding.com) und täglicher Kontrollbericht.
-- VOR dem Deploy von email-gateway / telegram-gateway / Frontend ausführen (die neuen Spalten werden dort gelesen).
-- Nur Schema, Regeln und eine Einstellungszeile — die Umstellung des Postfachs und der Mails macht die Aktion
-- `bereichspostfach_ueberfuehren` (email-gateway/bereichspostfach.ts, erst Trockenlauf, dann echter Lauf).
-- Mehrfach ausführbar.

-- ---------------------------------------------------------------------------------------------
-- A) Bereichspostfächer
-- ---------------------------------------------------------------------------------------------

-- postfaecher.bereich gesetzt = Bereichspostfach dieses Bereichs (dann ohne Besitzer);
-- verantwortlich_email = wer es betreut (darf davon senden, sieht die Ordnernamen).
alter table public.postfaecher add column if not exists bereich text;
alter table public.postfaecher add column if not exists verantwortlich_email text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'postfaecher_bereich_ohne_besitzer') then
    alter table public.postfaecher add constraint postfaecher_bereich_ohne_besitzer check (bereich is null or besitzer_email is null);
  end if;
end $$;

-- Mails aus einem Bereichspostfach tragen den Bereich (sichtbar nur für Mitarbeiter mit diesem Bereich).
alter table public.eingegangene_emails add column if not exists postfach_bereich text;
alter table public.gesendete_emails add column if not exists postfach_bereich text;
create index if not exists eingegangene_emails_postfach_id_idx on public.eingegangene_emails (postfach_id);
create index if not exists eingegangene_emails_postfach_bereich_idx on public.eingegangene_emails (postfach_bereich) where postfach_bereich is not null;
create index if not exists gesendete_emails_postfach_id_idx on public.gesendete_emails (postfach_id);

-- Einschränkende Regeln wie bei den anderen Bereichs-Tabellen (darf_bereich: Geschäftsführung/Admins immer,
-- sonst mitarbeiter.bereiche). Gemeinsame Mails (postfach_bereich leer) bleiben wie bisher.
drop policy if exists rechte_bereich_eingegangene_emails on public.eingegangene_emails;
create policy rechte_bereich_eingegangene_emails on public.eingegangene_emails
  as restrictive for all to authenticated
  using (postfach_bereich is null or public.darf_bereich(postfach_bereich))
  with check (postfach_bereich is null or public.darf_bereich(postfach_bereich));

drop policy if exists rechte_bereich_gesendete_emails on public.gesendete_emails;
create policy rechte_bereich_gesendete_emails on public.gesendete_emails
  as restrictive for all to authenticated
  using (postfach_bereich is null or public.darf_bereich(postfach_bereich))
  with check (postfach_bereich is null or public.darf_bereich(postfach_bereich));

drop policy if exists rechte_bereich_postfaecher on public.postfaecher;
create policy rechte_bereich_postfaecher on public.postfaecher
  as restrictive for all to authenticated
  using (bereich is null or public.darf_bereich(bereich))
  with check (bereich is null or public.darf_bereich(bereich));

-- Besitzer, Postfach und Bereich einer Mail ändert nur der Server (bisher: Besitzer und Postfach).
create or replace function public.schuetze_mail_besitzer()
returns trigger
language plpgsql
as $function$
begin
  if (new.besitzer_email is distinct from old.besitzer_email
      or new.postfach_id is distinct from old.postfach_id
      or new.postfach_bereich is distinct from old.postfach_bereich)
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'Besitzer und Postfach einer Mail lassen sich nur ueber den Server aendern.';
  end if;
  return new;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- C) Kontrollbericht: Einstellung und Stand nur für den Server
-- ---------------------------------------------------------------------------------------------

drop policy if exists kontrollbericht_nur_server on public.abteilung_eintraege;
create policy kontrollbericht_nur_server on public.abteilung_eintraege
  as restrictive for all to authenticated
  using (coalesce(art, '') <> all (array['kontrollbericht_einstellung', 'kontrollbericht_stand']))
  with check (coalesce(art, '') <> all (array['kontrollbericht_einstellung', 'kontrollbericht_stand']));

-- Standard: ein Eintrag Quirin Lutzenberger → Hasan Süslü, AN, werktags ab 18 Uhr (über den Mayer-Bot).
-- Eine vorhandene Zeile bleibt unverändert.
insert into public.abteilung_eintraege (id, art, daten, updated_at)
values (
  'kontrollbericht_einstellung',
  'kontrollbericht_einstellung',
  jsonb_build_object(
    'an', true,
    'stunde', 18,
    'eintraege', jsonb_build_array(jsonb_build_object('mitarbeiter', 'immo@amayer-holding.com', 'empfaenger', 'sueslue@hotmail.com', 'an', true))
  ),
  now()
)
on conflict (id) do nothing;

-- Kontrolle danach (nur lesen):
--   select id, bereich, besitzer_email, verantwortlich_email from public.postfaecher;
--   select policyname from pg_policies where policyname in ('rechte_bereich_eingegangene_emails', 'rechte_bereich_gesendete_emails', 'rechte_bereich_postfaecher', 'kontrollbericht_nur_server');
