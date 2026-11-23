-- Externe Gäste an Terminen (23.11.2026, Erays Wunsch per Telegram): beliebige E-Mail-Adressen einladen (Kalenderdatei),
-- Änderungen/Absage hinterher, Erinnerungsmail 1 Tag und 1 Stunde vorher (email-gateway/kalender.ts).
-- [{ email, name, eingeladen, sequenz }]
alter table termine add column if not exists gaeste jsonb not null default '[]'::jsonb;
