-- Umzug: To-dos, die eigentlich Erinnerungswünsche waren, in die Tabelle erinnerungen (25.11.2026) — NICHT automatisch
-- ausführen. Voraussetzungen: 2026-11-25_erinnerungen.sql ist ausgeführt UND telegram-gateway/email-gateway mit dem
-- Erinnerungs-Versand sind deployt (sonst warten künftige Erinnerungen, bis der Versand da ist; >2 Tage zu spät werden still
-- abgehakt).
--
-- Erkennung (Stand 25.11.2026, 10:45, lesend geprüft; Zeitraum: die letzten 7 Tage, nur Mayer-Assistent):
--   a) Herkunft: Der Telegram-Assistent hat das To-do angelegt, nachdem jemand um eine Erinnerung gebeten hat
--      (Bitte „Erinnerung an …“ / „Erinnere mich um …“ im Gesprächsverlauf mitarbeiter.telegram_pending → zuege/msgs,
--      Anlage im Aktionsprotokoll telegram_pending → aktionen mit todo_id). Der Verlauf reicht nur wenige Züge zurück;
--      ältere Bitten sind nicht mehr nachlesbar.
--   b) Wortlaut: Uhrzeit-Erinnerung + Text, der selbst eine Erinnerung ist (beginnt mit Erinnerung/erinnern/denk dran …,
--      oder „Termin …“-Hinweis kurz vor einem Termin).
--   Nicht umgezogen: Aufgabenlisten mit Tages-Erinnerung (echte Aufgaben, die ein Kollege zugewiesen hat), aus Microsoft
--   To Do abgeglichene private Aufgaben (ms_id), Bereichslisten.
--
-- Abbildung: fuer_email = Besitzer der Liste; „(von <Name>)“ am Ende des Textes → von_email/von_name des Kollegen und
-- der Zusatz fällt weg, sonst eigene Erinnerung; faellig_um = erinnern_um.
-- Schon vergangene Zeitpunkte (oder abgehakte To-dos) → erledigte Erinnerung (erledigt_am gesetzt, gesendet_am =
-- erinnert_am, falls die To-do-Erinnerung schon verschickt wurde) — wird nicht erneut gesendet.
-- Künftige → offene Erinnerung (kommt zur Uhrzeit per Telegram). Die To-dos werden danach aus der Liste gelöscht; eine
-- Sicherung bleibt in todos_sicherung_erinnerung_umzug.

-- =====================================================================================================
-- Teil 1: ansehen (nur lesen)
-- =====================================================================================================
with auswahl(id, grund) as (
  values
    ('todo_p99hcmtjq80', 'a: Bitte „Erinnerung an …“ an Kollegen (Telegram 25.11.)'),
    ('todo_c3nn8216lqi', 'a: Bitte „Erinnere mich um 13 Uhr …“ (Telegram 24.11.)'),
    ('todo_z2wof6q4o31', 'a: für Kollegen per Telegram mit fester Uhrzeit (24.11.), Muster wie oben'),
    ('todo_pou6haar5ix', 'a+b: Termin-Hinweis mit Erinnerung (Telegram 23.11.)'),
    ('todo_45lf51qr5nt', 'a+b: „Gleich Termin …“ eine Stunde vorher (Telegram 23.11.)')
), kandidaten as (
  select t.*, a.grund from public.todos t join auswahl a on a.id = t.id
  union
  -- b) Wortlaut allein (falls bis zur Ausführung neue dazukommen)
  select t.*, 'b: Wortlaut' from public.todos t
  where t.erinnern_um is not null and t.ms_id is null and t.bereich is null
    and t.erstellt_am >= to_char(current_date - 7, 'YYYY-MM-DD')
    and t.aufgabe ~* '^\s*(erinnerung|erinnere|erinnern|denk (bitte )?dran|nicht vergessen)'
)
select k.id, left(k.aufgabe, 80) as text, k.besitzer_email as fuer, m.name as von,
       to_char(k.erinnern_um at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as zeitpunkt,
       case when k.erledigt_am is not null or k.erinnern_um <= now() then 'wird erledigte Erinnerung' else 'kommt noch per Telegram' end as danach,
       k.erinnert_am is not null as schon_erinnert, k.grund
from kandidaten k
left join public.mitarbeiter m on k.aufgabe like '%(von ' || m.name || ')'
order by k.erinnern_um;

-- =====================================================================================================
-- Teil 2: Umzug (eine Transaktion; vorher Teil 1 ansehen, Liste oben bei Bedarf kürzen)
-- =====================================================================================================
begin;

create temporary table umzug on commit drop as
with auswahl(id) as (
  values ('todo_p99hcmtjq80'), ('todo_c3nn8216lqi'), ('todo_z2wof6q4o31'), ('todo_pou6haar5ix'), ('todo_45lf51qr5nt')
)
select t.* from public.todos t
where t.erinnern_um is not null and t.ms_id is null and t.bereich is null
  and (t.id in (select id from auswahl)
       or (t.erstellt_am >= to_char(current_date - 7, 'YYYY-MM-DD')
           and t.aufgabe ~* '^\s*(erinnerung|erinnere|erinnern|denk (bitte )?dran|nicht vergessen)'));

-- Sicherung der To-dos (bleibt bestehen; nach ein paar Tagen löschen: drop table public.todos_sicherung_erinnerung_umzug;)
create table if not exists public.todos_sicherung_erinnerung_umzug as select * from public.todos where false;
alter table public.todos_sicherung_erinnerung_umzug enable row level security; -- ohne Regeln: nur der Server liest
insert into public.todos_sicherung_erinnerung_umzug select t.* from public.todos t where t.id in (select id from umzug);

insert into public.erinnerungen (fuer_email, von_email, von_name, text, faellig_um, gesendet_am, erledigt_am, wiederholung, privat, erstellt_am, quelle)
select
  lower(u.besitzer_email),
  lower(coalesce(m.email, u.besitzer_email)),
  coalesce(m.name, (select b.name from public.mitarbeiter b where lower(b.email) = lower(u.besitzer_email) limit 1)),
  left(case when m.name is not null then btrim(replace(u.aufgabe, '(von ' || m.name || ')', '')) else u.aufgabe end, 500),
  u.erinnern_um,
  u.erinnert_am,
  case when u.erledigt_am is not null or u.erinnern_um <= now() then coalesce(u.erinnert_am, u.erinnern_um) else null end,
  '',
  false,
  coalesce(u.updated_at, now()),
  'umzug_todo'
from umzug u
left join public.mitarbeiter m on u.aufgabe like '%(von ' || m.name || ')' and lower(m.email) <> lower(u.besitzer_email);

delete from public.todos where id in (select id from umzug);

-- Kontrolle vor dem commit: so viele Zeilen wie in Teil 1.
select count(*) as umgezogen from public.erinnerungen where quelle = 'umzug_todo';

commit;

-- Rückgängig (falls nötig):
--   begin;
--   insert into public.todos select * from public.todos_sicherung_erinnerung_umzug on conflict (id) do nothing;
--   delete from public.erinnerungen where quelle = 'umzug_todo';
--   commit;
