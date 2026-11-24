-- Seite „Automatische Nachrichten“ (24.11.2026, Erays Wunsch): eine Stelle, an der alle automatischen Nachrichten mit
-- Anlass, Zeitpunkt, Schalter, Text und Verlauf stehen. Hier die gemeinsame Aufzeichnung dessen, was tatsächlich
-- hinausging und bisher nirgends gespeichert wurde (Telegram-Meldungen des Mayer-Bots, Mails an Termin-Gäste,
-- Buchungsbestätigung …). Der private Bot wird bewusst NICHT aufgezeichnet (Privates bleibt privat).
create table if not exists nachrichten_protokoll (
  id uuid primary key default gen_random_uuid(),
  am timestamptz not null default now(),
  art text not null default 'unbekannt',      -- Kennung aus dem Katalog (src/lib/automatik/katalog.ts), z. B. 'gast_einladung'
  kanal text not null,                         -- 'telegram' | 'mail'
  an_email text,
  an_name text,
  an_chat text,
  betreff text,
  text text,
  status text not null default 'gesendet',     -- 'gesendet' | 'fehler'
  bezug jsonb
);
create index if not exists nachrichten_protokoll_am on nachrichten_protokoll (am desc);
create index if not exists nachrichten_protokoll_art on nachrichten_protokoll (art, am desc);
alter table nachrichten_protokoll enable row level security;
drop policy if exists nachrichten_protokoll_lesen on nachrichten_protokoll;
create policy nachrichten_protokoll_lesen on nachrichten_protokoll for select to authenticated
  using (ist_geschaeftsfuehrung() or ist_superuser());
grant select on nachrichten_protokoll to authenticated;
-- Schreiben nur der Server (Dienstschlüssel).

-- „Bitte bestätigen“/Statusvorschläge im Verlauf der Seite: lesen dürfen Geschäftsführung und Superuser (bisher nur der Server).
drop policy if exists telegram_vorschlaege_lesen_gf on telegram_vorschlaege;
create policy telegram_vorschlaege_lesen_gf on telegram_vorschlaege for select to authenticated
  -- Vorschläge zu Mails aus persönlichen Postfächern (mail_privat) sieht nur der Empfänger selbst (Privates bleibt privat).
  using ((ist_geschaeftsfuehrung() or ist_superuser()) and (art <> 'mail_privat' or lower(empfaenger_email) = lower(auth.email())));
grant select on telegram_vorschlaege to authenticated;
