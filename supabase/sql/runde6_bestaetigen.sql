-- Runde 6 (23.11.2026): „Bitte bestätigen“ per Telegram-Knopf und Statusvorschläge.
-- Code: email-gateway/bitteBestaetigen.ts, email-gateway/statusVorschlag.ts, telegram-gateway/bitteBestaetigenWerkzeug.ts,
-- _shared/bestaetigenKern.ts. NOCH NICHT AUSGEFÜHRT — erst nach Freigabe:
--   /opt/homebrew/bin/supabase db query --linked -f supabase/sql/runde6_bestaetigen.sql
-- Ohne diese Tabelle tun Minutentakt und Knöpfe nichts (Fehler stehen nur im Protokoll).

create table if not exists public.telegram_vorschlaege (
  id text primary key,                       -- tv_… je Vorschlag; Verwaltungszeilen: 'einstellung', 'status_stand', 'lauf|<adresse>|<datum>'
  empfaenger_email text not null,            -- wer die Nachricht bekommt (klein geschrieben)
  art text not null check (art in ('termin', 'mail', 'mail_privat', 'eingang', 'status', 'lauf')),
  bezug_id text not null,                    -- Termin-, Mail- oder Dokument-Kennung; bei 'status' die Akte
  kunde_id text,                             -- vorgeschlagene Akte (bei Dateien ggf. Objekt-Kennung, siehe daten.ziel.art)
  daten jsonb not null default '{}'::jsonb,  -- Texte und Ziel (ZuordnungDaten / StatusDaten in _shared/bestaetigenKern.ts)
  code text not null,                        -- steht nur in der Telegram-Nachricht (Knopf)
  status text not null default 'offen' check (status in ('offen', 'laeuft', 'erledigt', 'ignoriert', 'nein', 'veraltet', 'fehler')),
  ergebnis text,
  telegram_nachricht jsonb,                  -- { chat, id } zum Ändern der Nachricht nach der Entscheidung
  erstellt_am timestamptz not null default now(),
  erledigt_am timestamptz
);

create index if not exists telegram_vorschlaege_empfaenger on public.telegram_vorschlaege (empfaenger_email, status);
create index if not exists telegram_vorschlaege_bezug on public.telegram_vorschlaege (art, bezug_id);
create index if not exists telegram_vorschlaege_kunde on public.telegram_vorschlaege (kunde_id, art, status);
create index if not exists telegram_vorschlaege_erstellt on public.telegram_vorschlaege (erstellt_am);

-- Nur der Server (Dienst-Schlüssel) liest und schreibt: Regeln eingeschaltet, aber keine für Logins.
alter table public.telegram_vorschlaege enable row level security;
revoke all on public.telegram_vorschlaege from anon, authenticated;

-- Schalter: Standard AUS für beides, Empfänger zuerst nur Eray. Einträge in "empfaenger": Adressen, 'superuser'
-- (alle mit mitarbeiter.ist_superuser) oder '*' (alle aktiven Mitarbeiter mit Telegram).
insert into public.telegram_vorschlaege (id, empfaenger_email, art, bezug_id, code, status, daten)
values ('einstellung', '-', 'lauf', '-', '-', 'erledigt', '{"zuordnung_an": false, "status_an": false, "empfaenger": ["eray.yesil@fundament-it.de"]}'::jsonb)
on conflict (id) do nothing;

-- Einschalten (erst nach Freigabe der Texte), z. B. nur für Eray:
--   update public.telegram_vorschlaege set daten = jsonb_set(jsonb_set(daten, '{zuordnung_an}', 'true'), '{status_an}', 'true') where id = 'einstellung';
-- Später für alle:
--   update public.telegram_vorschlaege set daten = jsonb_set(daten, '{empfaenger}', '["*"]') where id = 'einstellung';
-- Abschalten:
--   update public.telegram_vorschlaege set daten = jsonb_set(jsonb_set(daten, '{zuordnung_an}', 'false'), '{status_an}', 'false') where id = 'einstellung';
