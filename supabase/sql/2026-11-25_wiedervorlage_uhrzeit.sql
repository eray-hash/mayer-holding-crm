-- Wiedervorlage mit Uhrzeit (Wunsch Hasan 25.11.2026: „Wiedervorlage am Freitag 12 Uhr“).
-- uhrzeit: „HH:MM“ deutscher Ortszeit, sonst leer. Mit Uhrzeit legt der Assistent eine Erinnerung
-- (Tabelle erinnerungen) an und merkt sich deren id. Der Auslöser unten zieht die Erinnerung nach,
-- wenn die Wiedervorlage verschoben, erledigt oder gelöscht wird — egal ob im CRM oder per Telegram.
alter table public.wiedervorlagen add column if not exists uhrzeit text check (uhrzeit is null or uhrzeit ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.wiedervorlagen add column if not exists erinnerung_id uuid;

create or replace function public.wv_erinnerung_nachziehen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.erinnerung_id is not null then
      update erinnerungen set erledigt_am = now() where id = old.erinnerung_id and erledigt_am is null;
    end if;
    return old;
  end if;
  if new.erinnerung_id is null then return new; end if;
  if new.erledigt_am is not null and old.erledigt_am is null then
    update erinnerungen set erledigt_am = now() where id = new.erinnerung_id and erledigt_am is null;
  elsif new.faellig is distinct from old.faellig or new.uhrzeit is distinct from old.uhrzeit then
    update erinnerungen
       set faellig_um = ((new.faellig::text || ' ' || coalesce(new.uhrzeit, '09:00'))::timestamp at time zone 'Europe/Berlin'),
           gesendet_am = null, erledigt_am = null
     where id = new.erinnerung_id;
  end if;
  return new;
end $$;

drop trigger if exists wv_erinnerung_nachziehen on public.wiedervorlagen;
create trigger wv_erinnerung_nachziehen after update or delete on public.wiedervorlagen
  for each row execute function public.wv_erinnerung_nachziehen();
