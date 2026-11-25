-- Wiederkehrende To-do-Erinnerung (25.11.2026, Wunsch aus dem Wünsche-Tracking: „Tägliche wiederkehrende Erinnerung
-- bei To-dos“) — NICHT automatisch ausführen.
--
-- Neue Spalte todos.erinnerung_wiederholung: leer = einmalig (wie bisher), 'taeglich', 'werktags' (Mo–Fr) oder
-- 'woechentlich'. Der Zeitplan (email-gateway/todoErinnerung.ts) rückt erinnern_um nach jedem Versand auf das nächste
-- Vorkommen zur gleichen Berliner Uhrzeit, bis das To-do erledigt ist. Gesetzt im CRM (To-do bearbeiten → „Wiederholen“)
-- und vom Assistenten (todo_anlegen / todo_aendern).
-- Ohne diese Spalte laufen Versand und CRM weiter wie bisher (Versand liest dann ohne sie, das CRM schreibt das Feld nur,
-- wenn es jemand ändert).
--
-- Rechte (lesend geprüft 25.11.2026): todos hat Tabellen-Rechte für authenticated/anon/service_role (SELECT, INSERT,
-- UPDATE, DELETE auf die ganze Tabelle) — neue Spalten sind damit automatisch abgedeckt, anders als bei mitarbeiter.
-- Das GRANT unten ist deshalb nur eine Absicherung, falls die Tabellenrechte je auf Spaltenrechte umgestellt werden.
-- RLS-Regeln (todos lesen/schreiben/aendern/loeschen) sind zeilenbezogen und brauchen keine Änderung.
--
-- Auslöser auf todos (lesend geprüft):
--   todo_erinnerung_zuruecksetzen — leert erinnert_am, sobald sich erinnern_um ändert (das Weiterrücken nutzt das).
--   todo_geaendert — setzt updated_at bei jeder inhaltlichen Änderung (Grundlage der automatischen Priorisierung).
--     Das tägliche Weiterrücken durch den Zeitplan ist keine inhaltliche Änderung und wird unten ausgenommen.
--   todo_ms_aenderung — meldet Änderungen an erinnern_um an den Microsoft-To-Do-Abgleich (bleibt so: dort erscheint dann
--     die nächste Erinnerungszeit).

alter table public.todos add column if not exists erinnerung_wiederholung text;

alter table public.todos drop constraint if exists todos_erinnerung_wiederholung_pruefen;
alter table public.todos add constraint todos_erinnerung_wiederholung_pruefen
  check (erinnerung_wiederholung is null or erinnerung_wiederholung in ('taeglich', 'werktags', 'woechentlich'));

grant select, insert, update (erinnerung_wiederholung) on public.todos to authenticated;

-- Wie bisher, plus: Rückt der Zeitplan eine wiederkehrende Erinnerung nach dem Versand weiter (erinnert_am war gesetzt,
-- Wiederholung ist an, die Zeit wandert nach vorn), zählt das nicht als inhaltliche Änderung.
create or replace function public.todo_geaendert()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare ohne text[] := array['updated_at','prio','reihenfolge','prio_grund','prio_am','ms_id','ms_liste_id','ms_liste_name','ms_geaendert','ms_hash','ms_crm_geaendert','erinnert_am'];
begin
  -- updated_at = letzte inhaltliche Änderung (für die automatische Priorisierung, todoPriorisierung.ts).
  -- Prio/Reihenfolge/Begründung und der Microsoft-Abgleich zählen nicht; prio_quelle schon (hand / wieder automatisch).
  if new.erinnerung_wiederholung is not null and old.erinnerung_wiederholung is not distinct from new.erinnerung_wiederholung
     and old.erinnert_am is not null and new.erinnern_um > old.erinnern_um then
    ohne := ohne || array['erinnern_um'];
  end if;
  if (to_jsonb(new) - ohne) is distinct from (to_jsonb(old) - ohne) then new.updated_at := now(); end if;
  return new;
end $function$;

-- Kontrolle danach:
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'todos' and column_name = 'erinnerung_wiederholung';
