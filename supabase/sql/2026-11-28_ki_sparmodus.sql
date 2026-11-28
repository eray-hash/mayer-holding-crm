-- Sparschalter für den KI-Dienst (28.11.2026): Aufrufe, die Sonnet 5.5 anfordern, laufen stattdessen auf Haiku 5.5.
-- modus: 'aus' (nichts ändert sich), 'personen' (nur für die Login-Adressen in personen), 'alle'.
-- ausnahmen: Anlässe (z. B. 'bonitaet'), die immer bei Sonnet bleiben. Nur der Server liest die Tabelle.
create table if not exists ki_spar_einstellung (
  id integer primary key default 1 check (id = 1),
  modus text not null default 'aus' check (modus in ('aus', 'personen', 'alle')),
  personen text[] not null default '{}',
  ausnahmen text[] not null default '{}',
  geaendert_am timestamptz not null default now(),
  geaendert_von text
);
alter table ki_spar_einstellung enable row level security;
insert into ki_spar_einstellung (id) values (1) on conflict (id) do nothing;
