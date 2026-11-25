-- Erinnerungen als eigene Sache (25.11.2026, Wunsch der Geschäftsführung: „Eine Erinnerung ist kein To-do, sondern eine
-- Erinnerung.“) — NICHT automatisch ausführen. Wiederholbar (if not exists / drop policy if exists).
--
-- Wer schreibt:
--   - Telegram-Assistent (erinnerung_anlegen/_verschieben/_loeschen, telegram-gateway/erinnerungWerkzeuge.ts) mit dem
--     Dienstschlüssel, auch für Kollegen (von_email = Auftraggeber, fuer_email = Kollege),
--   - der Minuten-Zeitplan (email-gateway/erinnerungVersand.ts) setzt gesendet_am bzw. rückt Wiederholungen weiter,
--   - das CRM (Karte „Meine Erinnerungen“) für die eigenen bzw. selbst bestellten Erinnerungen über die Regeln unten.
-- Solange die Datei nicht ausgeführt ist, melden die Werkzeuge „Tabelle fehlt“, der Zeitplan überspringt still.

create table if not exists public.erinnerungen (
  id uuid primary key default gen_random_uuid(),
  fuer_email text not null,                 -- wer erinnert wird (klein geschrieben)
  von_email text,                           -- wer die Erinnerung bestellt hat (gleich fuer_email = eigene)
  von_name text,
  text text not null check (length(text) between 1 and 500),
  faellig_um timestamptz not null,
  kunde_id text,
  kunde_bereich text,
  objekt_id text,
  gesendet_am timestamptz,                  -- gesetzt VOR dem Versand (beansprucht), bei Fehlschlag zurückgenommen
  erledigt_am timestamptz,
  wiederholung text not null default '' check (wiederholung in ('', 'taeglich', 'woechentlich', 'monatlich')),
  privat boolean not null default false,    -- im privaten Assistenten angelegt: nur über den privaten Bot, nie Mayer-seitig
  erstellt_am timestamptz not null default now(),
  quelle text not null default 'crm'        -- 'telegram' | 'telegram_privat' | 'crm' | 'umzug_todo'
);
-- Privat nur für sich selbst.
alter table public.erinnerungen drop constraint if exists erinnerungen_privat_nur_eigene;
alter table public.erinnerungen add constraint erinnerungen_privat_nur_eigene
  check (not privat or von_email is null or lower(von_email) = lower(fuer_email));

-- Zeitplan: offene, noch nicht gesendete nach Fälligkeit.
create index if not exists erinnerungen_faellig on public.erinnerungen (faellig_um) where gesendet_am is null and erledigt_am is null;
create index if not exists erinnerungen_fuer on public.erinnerungen (lower(fuer_email));
create index if not exists erinnerungen_von on public.erinnerungen (lower(von_email));

alter table public.erinnerungen enable row level security;

-- Lesen: eigene (fuer) und selbst bestellte (von); Geschäftsführung/Superuser lesen alle außer privaten.
drop policy if exists erinnerungen_lesen on public.erinnerungen;
create policy erinnerungen_lesen on public.erinnerungen for select to authenticated
  using (
    ist_aktiver_mitarbeiter() and (
      lower(fuer_email) = lower(auth.jwt()->>'email')
      or lower(von_email) = lower(auth.jwt()->>'email')
      or ((ist_geschaeftsfuehrung() or ist_superuser()) and not privat)
    )
  );

-- Anlegen im CRM: nur als Auftraggeber selbst; private nur für sich.
drop policy if exists erinnerungen_anlegen on public.erinnerungen;
create policy erinnerungen_anlegen on public.erinnerungen for insert to authenticated
  with check (
    ist_aktiver_mitarbeiter()
    and lower(von_email) = lower(auth.jwt()->>'email')
    and (not privat or lower(fuer_email) = lower(auth.jwt()->>'email'))
  );

-- Ändern (verschieben, erledigt) und löschen: nur Empfänger oder Auftraggeber.
drop policy if exists erinnerungen_aendern on public.erinnerungen;
create policy erinnerungen_aendern on public.erinnerungen for update to authenticated
  using (ist_aktiver_mitarbeiter() and (lower(fuer_email) = lower(auth.jwt()->>'email') or lower(von_email) = lower(auth.jwt()->>'email')))
  with check (ist_aktiver_mitarbeiter() and (lower(fuer_email) = lower(auth.jwt()->>'email') or lower(von_email) = lower(auth.jwt()->>'email')));

drop policy if exists erinnerungen_loeschen on public.erinnerungen;
create policy erinnerungen_loeschen on public.erinnerungen for delete to authenticated
  using (ist_aktiver_mitarbeiter() and (lower(fuer_email) = lower(auth.jwt()->>'email') or lower(von_email) = lower(auth.jwt()->>'email')));

grant select, insert, update, delete on public.erinnerungen to authenticated;

-- =====================================================================================================
-- Prüfabfragen (nur lesen)
-- =====================================================================================================
-- Offene je Empfänger:
--   select fuer_email, count(*) from public.erinnerungen where erledigt_am is null and gesendet_am is null group by 1;
-- Was ging heute raus:
--   select fuer_email, left(text, 60), faellig_um, gesendet_am from public.erinnerungen where gesendet_am::date = current_date order by gesendet_am;
-- Im Protokoll (ohne private):
--   select am, an_chat, text, status from public.nachrichten_protokoll where art = 'erinnerung' order by am desc limit 20;
