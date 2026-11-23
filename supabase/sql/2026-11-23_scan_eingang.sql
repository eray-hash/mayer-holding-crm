-- Scan-Eingang (23.11.2026): eingescannte Papierakten, die ein Kopierer/Scanner an info@ schickt (Betreff = Name der Akte),
-- werden vom Server aufgeteilt, gelesen und Teil für Teil in die passende Akte gelegt (email-gateway/scanEingang.ts).
create table if not exists scan_eingang (
  id text primary key default 'standard',
  aktiv boolean not null default true,
  -- Absenderadressen der Scanner/Kopierer (klein geschrieben). Nur Mails von diesen Adressen laufen durch den Scan-Eingang.
  absender text[] not null default '{}',
  geaendert_am timestamptz not null default now()
);
alter table scan_eingang enable row level security;
grant select on scan_eingang to authenticated;
drop policy if exists scan_eingang_lesen on scan_eingang;
create policy scan_eingang_lesen on scan_eingang for select to authenticated using (true);

alter table eingegangene_emails add column if not exists scan_status text;          -- null | laeuft | fertig | fehler
alter table eingegangene_emails add column if not exists scan_beansprucht_am timestamptz;
alter table eingegangene_emails add column if not exists scan_versuche integer not null default 0;
alter table eingegangene_emails add column if not exists scan_ergebnis jsonb;

-- Feste Zuordnung Betreff → Akte (z. B. Ordner ohne Kundennamen: „ki manager“ → Akademie-Akte „Seminar KI-Manager (AZAV)“).
alter table scan_eingang add column if not exists betreff_akten jsonb not null default '{}'::jsonb;
update scan_eingang set betreff_akten = betreff_akten || '{"ki manager": "k_eaa19f5d2445"}'::jsonb where id = 'standard';
