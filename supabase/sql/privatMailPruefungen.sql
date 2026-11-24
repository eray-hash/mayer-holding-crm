-- Gemeinsame Prüf-Tabelle für Mails aus dem privaten Microsoft-Postfach (24.11.2026): merkt sich je Login und Art,
-- welche Mail schon geprüft wurde (jede Mail nur einmal je Art zur KI) und was dabei herauskam.
-- Nutzer:
--   art 'zusage' — Zusagen in gesendeten Mails (supabase/functions/email-gateway/mailFolgen.ts)
--   art 'termin' — Termine aus Mails            (supabase/functions/email-gateway/terminAusMail.ts)
-- Weitere Arten brauchen keine Änderung (art und ergebnis sind bewusst frei).
-- Rein additiv. NOCH NICHT AUSGEFÜHRT — erst nach Freigabe:
--   /opt/homebrew/bin/supabase db query --linked -f supabase/sql/privatMailPruefungen.sql
-- Ohne diese Tabelle bricht der jeweilige Lauf mit „geprüfte Mails nicht lesbar“ ab (keine KI-Aufrufe, nichts vorgemerkt).

create table if not exists public.privat_mail_pruefungen (
  id uuid primary key default gen_random_uuid(), -- im Code fest aus Login|Art|Mail abgeleitet, dadurch doppelt-sicher
  login_email text not null,                     -- CRM-Login, klein geschrieben
  art text not null,                             -- 'zusage', 'termin', …
  mail_id text not null,                         -- internetMessageId (bleibt beim Verschieben gleich), sonst Graph-Kennung
  geprueft_am timestamptz not null default now(),
  ergebnis text not null default 'laeuft',       -- z. B. laeuft, zusage, keine_zusage, termin, kein_termin, unsicher, unlesbar, vergangen, doppelt
  vormerkung_id text,                            -- vm_… in public.vormerkungen, wenn etwas zur Bestätigung vorgeschlagen wurde
  erstellt_am timestamptz not null default now(),
  unique (login_email, art, mail_id)
);

create index if not exists privat_mail_pruefungen_login_art_geprueft on public.privat_mail_pruefungen (login_email, art, geprueft_am);

-- Lesen nur der Besitzer selbst; schreiben nur der Server (Dienst-Schlüssel, umgeht die Regeln).
alter table public.privat_mail_pruefungen enable row level security;
drop policy if exists "privat_mail_pruefungen eigene lesen" on public.privat_mail_pruefungen;
create policy "privat_mail_pruefungen eigene lesen" on public.privat_mail_pruefungen for select
  using (lower(login_email) = lower(auth.jwt() ->> 'email'));
revoke all on public.privat_mail_pruefungen from anon, authenticated;
grant select on public.privat_mail_pruefungen to authenticated;
grant all on public.privat_mail_pruefungen to service_role;

-- Aufräumen (optional, z. B. monatlich): alte Prüfungen braucht niemand mehr.
--   delete from public.privat_mail_pruefungen where geprueft_am < now() - interval '60 days';
