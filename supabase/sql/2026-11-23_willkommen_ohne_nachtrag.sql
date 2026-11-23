CREATE OR REPLACE FUNCTION public.wk_kunden_ausloeser()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e record;
  adresse text;
  ausloeser text;
begin
  begin
    if new.bereich is null or new.bereich = 'privat' or new.id in ('k_eingang_ungeklaert', 'k_intern_holding') then
      return null;
    end if;
    adresse := nullif(trim(coalesce(new.email, '')), '');
    if adresse is not null and adresse !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then adresse := null; end if;

    -- Schon vorgemerkt, aber ohne Adresse: kommt die Adresse dazu, jetzt einplanen.
    if tg_op = 'UPDATE' and adresse is not null and new.email is distinct from old.email then
      select * into e from willkommen_einstellung where id = 1;
      update willkommen_nachrichten set status = 'geplant', an = adresse, an_name = coalesce(nullif(new.ansprechpartner, ''), new.firma),
        senden_ab = now() + make_interval(mins => coalesce(e.verzoegerung_minuten, 60)), grund = null
      where kunde_id = new.id and status = 'ohne_adresse';
    end if;

    if not wk_erster_stand(new.bereich, new.status) then return null; end if;
    if tg_op = 'UPDATE' then
      -- Nur der Schritt aus der Neuanfrage heraus (Beratung: „Lead / Neuanfrage“ → „Erstkontakt“).
      if old.status is not distinct from new.status or old.status <> 'lead' then return null; end if;
      -- Alte Neuanfragen aus dem Nachtrag vom 23.11.2026 (Wiedervorlage „Neuanfrage prüfen“): beim Einstufen als
      -- „qualifiziert“ keine Willkommensnachricht — das Gespräch liegt oft Wochen zurück (Erays Entscheidung).
      if exists (select 1 from wiedervorlagen w where w.kunde_id = new.id and w.erstellt_von = 'Nachtrag 23.11.2026') then
        return null;
      end if;
      ausloeser := 'Neuanfrage → Erstkontakt';
    else
      -- Akten, die das CRM selbst anlegt, um eine Datei oder Nachricht abzulegen, bekommen nichts.
      if exists (select 1 from jsonb_array_elements(wv_liste(new.activities)) a where a->>'text' ilike '%automatisch angelegt%') then
        return null;
      end if;
      -- Akten mit älterem Verlauf (Import aus Listen, Wiederherstellen einer Sicherung) sind keine neuen Kunden.
      if exists (select 1 from jsonb_array_elements(wv_liste(new.activities)) a
                 where left(coalesce(a->>'date', ''), 10) ~ '^\d{4}-\d{2}-\d{2}$'
                   and left(a->>'date', 10)::date < (now() at time zone 'Europe/Berlin')::date - 2) then
        return null;
      end if;
      ausloeser := 'Akte angelegt';
    end if;

    select * into e from willkommen_einstellung where id = 1;
    if not coalesce(e.aktiv, false) then return null; end if;

    insert into willkommen_nachrichten (kunde_id, bereich, an, an_name, status, senden_ab, ausloeser, grund)
    values (new.id, new.bereich, adresse, coalesce(nullif(new.ansprechpartner, ''), new.firma),
      case when adresse is null then 'ohne_adresse' else 'geplant' end,
      now() + make_interval(mins => coalesce(e.verzoegerung_minuten, 60)), ausloeser,
      case when adresse is null then 'Keine E-Mail-Adresse in der Akte' end)
    on conflict (kunde_id) do nothing;
  exception when others then
    raise warning 'Willkommensnachricht (%): %', tg_name, sqlerrm;
  end;
  return null;
end $function$
;
select 'ok' r;
