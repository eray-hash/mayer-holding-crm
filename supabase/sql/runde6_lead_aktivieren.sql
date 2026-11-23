-- Runde 6, Punkt 2: Wiedervorlage „Neuanfrage prüfen“ für Beratungs-Leads aktivieren + gestaffelter Nachtrag (von Eray am 23.11.2026 freigegeben).
-- Im Supabase SQL-Editor komplett einfügen und ausführen. Ein zweiter Lauf legt nichts doppelt an.
-- =====================================================================================================
-- Teil A — Punkt 2: Wiedervorlage für Neuanfragen in der Unternehmensberatung
-- =====================================================================================================

-- A1) Zwei neue Regeln im Katalog (gleicher Mechanismus wie die 46 vom 20.11.):
--     - Stand „lead“ (Neuanfrage) in der Beratung → nach 2 Tagen „Neuanfrage prüfen“; schließt sich beim nächsten
--       Statuswechsel von selbst (statuswechsel).
--     - Stand „wiedervorlage“ (zurückgestellt) in der Beratung → nach 14 Tagen erneut prüfen. Damit legt
--       „später“ beim Assistenten (lead_einstufen) die Wiedervorlage über denselben Weg an.
insert into wiedervorlage_regeln (id, bereich, ausloeser, titel, tage, schliesst, sortierung, aktiv) values
  ('ber_neuanfrage_pruefen', 'beratung', 'status:lead', 'Neuanfrage prüfen: qualifiziert, passt nicht oder später?', 2, array['statuswechsel']::text[], 46, true),
  ('ber_zurueckgestellt', 'beratung', 'status:wiedervorlage', 'Zurückgestellte Anfrage erneut prüfen', 14, array['statuswechsel']::text[], 47, true)
on conflict (id) do update set bereich = excluded.bereich, ausloeser = excluded.ausloeser, titel = excluded.titel, tage = excluded.tage,
  schliesst = excluded.schliesst, sortierung = excluded.sortierung, aktiv = excluded.aktiv;

-- A2) Auslöser an kunden: Bisher bekam eine Akte, die mit Stand „lead“ angelegt wird, gar nichts („es wären Dutzende“).
--     Jetzt ruft auch der Anlage-Fall wv_anlegen auf — Regeln für „status:lead“ gibt es nur in der Beratung
--     (A1), alle anderen Bereiche bekommen weiterhin nichts. Sonst unverändert gegenüber dem Stand vom 20.11.
create or replace function public.wv_kunden_ausloeser()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  alt_ang int; neu_ang int; alt_ein int; neu_ein int; offen int;
begin
  begin
  if tg_op = 'INSERT' then
    -- Neue Akten bekommen die Wiedervorlage ihres ersten Stands. Für „lead“ gibt es nur in der Beratung eine
    -- Regel („Neuanfrage prüfen“, Runde 6 vom 23.11.2026); in allen anderen Bereichen entsteht dabei nichts.
    perform wv_anlegen(new.id, 'status:' || new.status);
    return null;
  end if;

  if new.status is distinct from old.status then
    -- Erst Einträge des alten Stands schließen, die nur für ihn galten, dann die des neuen anlegen.
    update wiedervorlagen w set erledigt_am = now(), erledigt_von = 'automatisch', erledigt_grund = 'Stand geändert'
    from wiedervorlage_regeln r
    where w.kunde_id = new.id and w.erledigt_am is null and w.regel = r.id
      and 'statuswechsel' = any (r.schliesst) and r.ausloeser <> 'status:' || new.status;
    perform wv_anlegen(new.id, 'status:' || new.status);
  end if;

  if new.bereich is distinct from old.bereich then
    update wiedervorlagen set bereich = new.bereich where kunde_id = new.id and new.bereich <> 'privat';
  end if;

  -- Verantwortlicher geändert: offene Wiedervorlagen ziehen mit — nur die, die beim alten oder bei niemandem standen.
  if new.verantwortlich is distinct from old.verantwortlich and coalesce(trim(new.verantwortlich), '') <> '' then
    update wiedervorlagen set verantwortlich = new.verantwortlich
    where kunde_id = new.id and erledigt_am is null
      and (coalesce(trim(verantwortlich), '') = '' or (quelle = 'regel' and verantwortlich is not distinct from old.verantwortlich));
  end if;

  -- Unterlagen: neue Anforderung → nachfordern; neuer Eingang → prüfen; alles da → nachfordern erledigt.
  if new.unterlagen_anforderungen is distinct from old.unterlagen_anforderungen then
    select count(*) into alt_ang from jsonb_array_elements(wv_liste(old.unterlagen_anforderungen)) a where a->>'art' = 'anforderung';
    select count(*) into neu_ang from jsonb_array_elements(wv_liste(new.unterlagen_anforderungen)) a where a->>'art' = 'anforderung';
    select count(*) into alt_ein from jsonb_array_elements(wv_liste(old.unterlagen_anforderungen)) a, jsonb_array_elements(wv_liste(a->'eingang')) e;
    select count(*) into neu_ein from jsonb_array_elements(wv_liste(new.unterlagen_anforderungen)) a, jsonb_array_elements(wv_liste(a->'eingang')) e;
    if neu_ang > alt_ang then perform wv_anlegen(new.id, 'ereignis:unterlagen_angefordert'); end if;
    if neu_ein > alt_ein then
      perform wv_anlegen(new.id, 'ereignis:unterlagen_eingegangen');
      -- Fehlt noch ein angeforderter Punkt?
      select count(*) into offen from (
        select distinct p.value #>> '{}' as punkt
        from jsonb_array_elements(wv_liste(new.unterlagen_anforderungen)) a, jsonb_array_elements(wv_liste(a->'punkte')) p
        where a->>'art' = 'anforderung'
      ) angefordert
      where punkt not in (
        select e->>'punkt' from jsonb_array_elements(wv_liste(new.unterlagen_anforderungen)) a, jsonb_array_elements(wv_liste(a->'eingang')) e
        where e->>'punkt' is not null
      );
      if offen = 0 then perform wv_schliessen(new.id, 'unterlagen_vollstaendig', 'Alle Unterlagen eingegangen'); end if;
    end if;
  end if;

  if jsonb_array_length(wv_liste(new.signaturen)) > jsonb_array_length(wv_liste(old.signaturen)) then
    perform wv_schliessen(new.id, 'unterschrift', 'Unterschrift eingegangen');
  end if;
  return null;
  exception when others then
    -- Wiedervorlagen sind Beiwerk: ein Fehler hier darf das Speichern nie verhindern.
    raise warning 'Wiedervorlage (%): %', tg_name, sqlerrm;
  end;
  return null;
end $function$;


-- =====================================================================================================
-- Teil D — Nachtrag für die bestehenden Akten (NUR nach Erays Ja; nach Teil A)
-- =====================================================================================================
-- Die 69 Beratungs-Akten auf „lead“ (und die 2 auf „wiedervorlage“) bekommen ihre Wiedervorlage nachträglich,
-- gestaffelt auf die Werktage ab Mittwoch 25.11.2026: höchstens 5 je Werktag (69 Leads ≈ 14 Werktage bis 14.12.).
-- Reihenfolge: Akten mit Telefon oder E-Mail zuerst (die kann man sofort anrufen), darin die zuletzt geänderten
-- zuerst. Zuständig = Verantwortlicher der Akte. Doppelte verhindert der Index wiedervorlagen_regel_offen
-- (on conflict do nothing) — ein zweiter Lauf legt nichts doppelt an.
with werktage as (
  select d::date as tag, row_number() over (order by d) - 1 as nr
  from generate_series(date '2026-11-25', date '2027-01-31', interval '1 day') d
  where extract(isodow from d) < 6
    and d::date not in (date '2026-12-24', date '2026-12-25', date '2026-12-26', date '2026-12-31', date '2027-01-01', date '2027-01-06')
), kandidaten as (
  select k.id, k.bereich, k.verantwortlich, r.id as regel, r.titel,
    row_number() over (
      order by (coalesce(trim(k.email), '') <> '' or coalesce(trim(k.telefon), '') <> '') desc, k.updated_at desc nulls last, k.id
    ) - 1 as nr
  from kunden k
  join wiedervorlage_regeln r on r.aktiv and r.bereich = 'beratung' and r.ausloeser = 'status:' || k.status
  where k.bereich = 'beratung' and k.status in ('lead', 'wiedervorlage')
    and k.id not in ('k_eingang_ungeklaert', 'k_intern_holding')
    and not exists (select 1 from wiedervorlagen w where w.kunde_id = k.id and w.erledigt_am is null and w.regel = r.id)
)
insert into wiedervorlagen (kunde_id, bereich, regel, titel, faellig, verantwortlich, quelle, erstellt_von)
select k.id, k.bereich, k.regel, k.titel, w.tag, nullif(trim(k.verantwortlich), ''), 'regel', 'Nachtrag 23.11.2026'
from kandidaten k
join werktage w on w.nr = k.nr / 5
on conflict do nothing;

select count(*) as nachgetragen, min(faellig) as ab, max(faellig) as bis from wiedervorlagen where erstellt_von = 'Nachtrag 23.11.2026';
