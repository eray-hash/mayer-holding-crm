-- Privat bleibt privat (25.11.2026): Altlasten aus der Zeit, als die Termin-Zuordnung private Outlook-Termine wie
-- Firmentermine behandelt hat. NICHT automatisch ausführen — erst Teil 0 (nur lesen) laufen lassen, dann Teil 1–3.
--
-- Privater Termin (wie _shared/privatGrenze.ts istPrivaterTermin):
--   keine Kollegen (teilnehmer leer) UND keine Mayer-Akte (kunde_id leer oder kunde_bereich 'privat') UND
--   (aus Outlook (ms_id) ODER private Akte ODER Besitzer nutzt den privaten Assistenten).
-- „Nutzt den privaten Assistenten“ = privat_einstellungen.briefing.privatBot = true (die Freischaltung MS_ERLAUBT
-- kennt die Datenbank nicht; ohne sie gilt der Vermerk trotzdem — das ist hier die strengere Wahl).
--
-- Stand beim Schreiben (25.11.2026, lesend gezählt): 798 private Termine, davon 86 mit offenem Vorschlag auf eine
-- Mayer-Akte, 0 mit Vorschlag auf eine eigene private Akte; 0 offene „Bitte bestätigen“-Vorschläge (die 4 zu Terminen
-- sind schon „ignoriert“); 0 offene mail_privat-Vorschläge an Nutzer des privaten Assistenten; 0 private
-- Outlook-Termine, die automatisch (Gast-Adresse) einer Mayer-Akte zugeordnet wurden.

-- =====================================================================================================
-- Teil 0: nur lesen
-- =====================================================================================================
with pa as (select lower(login_email) e from privat_einstellungen where (briefing->>'privatBot') = 'true'),
p as (
  select t.* from termine t
  where coalesce(array_length(array_remove(t.teilnehmer, ''), 1), 0) = 0
    and (t.kunde_id is null or t.kunde_bereich = 'privat')
    and (t.ms_id is not null or t.kunde_bereich = 'privat' or exists (select 1 from pa where pa.e = lower(t.besitzer_email)))
)
select 'private Termine' was, count(*) n from p
union all select 'davon Vorschlag auf Mayer-Akte (wird geleert)', count(*) from p
  where p.zuordnung_vorschlag->>'stand' = 'vorschlag'
    and not exists (select 1 from kunden k where k.id = p.zuordnung_vorschlag->>'kunde_id' and k.bereich = 'privat' and lower(k.verantwortlich_email) = lower(p.besitzer_email))
union all select 'offene Bitte-bestätigen-Vorschläge dazu (werden ignoriert)', count(*) from telegram_vorschlaege v
  where v.art = 'termin' and v.status = 'offen' and (v.daten->'ziel'->>'bereich' = 'privat' or exists (select 1 from p where p.id::text = v.bezug_id))
union all select 'offene mail_privat-Vorschläge an Nutzer des privaten Assistenten (werden ignoriert)', count(*) from telegram_vorschlaege v
  where v.art = 'mail_privat' and v.status = 'offen' and exists (select 1 from pa where pa.e = lower(v.empfaenger_email))
union all select 'private Outlook-Termine automatisch einer Mayer-Akte zugeordnet (nur Hinweis, Teil 4)', count(*) from termine t
  where coalesce(array_length(array_remove(t.teilnehmer, ''), 1), 0) = 0 and t.ms_id is not null and t.kunde_id is not null
    and coalesce(t.kunde_bereich, '') <> 'privat' and t.zuordnung_vorschlag->>'stand' = 'automatisch';

-- =====================================================================================================
-- Teil 1: Vorschläge auf Mayer-Akten bei privaten Terminen zurücknehmen (stand 'keiner'; die Liste „abgelehnt“ bleibt,
-- die vorgeschlagene Akte kommt dazu — sie wird für diesen Termin nie wieder vorgeschlagen). Vorschläge auf eine
-- private Akte desselben Besitzers bleiben (die sieht er nur im privaten Assistenten).
-- =====================================================================================================
begin;
with pa as (select lower(login_email) e from privat_einstellungen where (briefing->>'privatBot') = 'true')
update termine t
set zuordnung_vorschlag = jsonb_build_object(
      'stand', 'keiner',
      'wie', 'privat – automatisch zurückgezogen',
      'am', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'abgelehnt', (
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(t.zuordnung_vorschlag->'abgelehnt', '[]'::jsonb) || jsonb_build_array(t.zuordnung_vorschlag->>'kunde_id')) x
        where x is not null and x <> ''
      )
    )
where t.zuordnung_vorschlag->>'stand' = 'vorschlag'
  and coalesce(array_length(array_remove(t.teilnehmer, ''), 1), 0) = 0
  and (t.kunde_id is null or t.kunde_bereich = 'privat')
  and (t.ms_id is not null or t.kunde_bereich = 'privat' or exists (select 1 from pa where pa.e = lower(t.besitzer_email)))
  and not exists (
    select 1 from kunden k
    where k.id = t.zuordnung_vorschlag->>'kunde_id' and k.bereich = 'privat' and lower(k.verantwortlich_email) = lower(t.besitzer_email)
  );

-- =====================================================================================================
-- Teil 2: offene „Bitte bestätigen“-Vorschläge zu privaten Terminen bzw. auf private Akten zurückziehen.
-- =====================================================================================================
with pa as (select lower(login_email) e from privat_einstellungen where (briefing->>'privatBot') = 'true'),
p as (
  select t.id from termine t
  where coalesce(array_length(array_remove(t.teilnehmer, ''), 1), 0) = 0
    and (t.kunde_id is null or t.kunde_bereich = 'privat')
    and (t.ms_id is not null or t.kunde_bereich = 'privat' or exists (select 1 from pa where pa.e = lower(t.besitzer_email)))
)
update telegram_vorschlaege v
set status = 'ignoriert', ergebnis = 'privat – automatisch zurückgezogen', erledigt_am = now()
where v.art = 'termin' and v.status = 'offen'
  and (v.daten->'ziel'->>'bereich' = 'privat' or exists (select 1 from p where p.id::text = v.bezug_id));

-- =====================================================================================================
-- Teil 3: offene Vorschläge aus dem persönlichen Postfach an Nutzer des privaten Assistenten zurückziehen
-- (ihre persönliche Post ist privat; im privaten Assistenten gibt es meine_post_vorschlaege).
-- =====================================================================================================
with pa as (select lower(login_email) e from privat_einstellungen where (briefing->>'privatBot') = 'true')
update telegram_vorschlaege v
set status = 'ignoriert', ergebnis = 'privat – automatisch zurückgezogen', erledigt_am = now()
where v.art = 'mail_privat' and v.status = 'offen' and exists (select 1 from pa where pa.e = lower(v.empfaenger_email));
commit;

-- =====================================================================================================
-- Teil 4 (nur bei Bedarf, bewusst auskommentiert): private Outlook-Termine, die die alte Regel automatisch über eine
-- Gast-Adresse einer Mayer-Akte zugeordnet hat, wieder lösen. Stand 25.11.2026: 0 Zeilen.
-- =====================================================================================================
-- update termine t
-- set kunde_id = null, kunde_bereich = null, kunde_name = null,
--     zuordnung_vorschlag = jsonb_build_object('stand', 'keiner', 'wie', 'privat – automatisch zurückgezogen', 'am', now(),
--       'abgelehnt', coalesce(t.zuordnung_vorschlag->'abgelehnt', '[]'::jsonb) || jsonb_build_array(t.kunde_id))
-- where coalesce(array_length(array_remove(t.teilnehmer, ''), 1), 0) = 0 and t.ms_id is not null and t.kunde_id is not null
--   and coalesce(t.kunde_bereich, '') <> 'privat' and t.zuordnung_vorschlag->>'stand' = 'automatisch';
