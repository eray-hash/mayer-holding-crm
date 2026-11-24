-- Entgangene Klienten (24.11.2026, Wunsch der Geschäftsführung): warum uns Klienten entgehen.
-- Neue Spalte kunden.verloren — gesetzt, solange die Akte auf „Verloren / Kein Interesse“ steht:
--   { grund, notiz?, am (JJJJ-MM-TT), von, phaseVorher? (Status davor), wertNetto? (entgangener Betrag netto),
--     vermittler? (Name aus kunden.vermittler) }
-- grund ist eine feste Kennung (keine_rueckmeldung, eigener_steuerberater, zu_teuer, kein_bedarf, konkurrenz,
-- zahlt_nicht, zeitpunkt, passt_nicht, persoenlich, sonstiges) — Liste und Bezeichnungen in
-- supabase/functions/_shared/entgangenKern.ts. Wird die Akte wieder aufgenommen, wird die Spalte geleert;
-- die Historie steht im Verlauf (kunden.activities).
-- Geschrieben vom CRM (Status-Dialog, Seite /entgangen) und vom Telegram-Assistenten (als_entgangen_markieren).
--
-- Rechte: kunden hat Tabellen-Rechte für authenticated (SELECT/INSERT/UPDATE auf die ganze Tabelle, geprüft am
-- 24.11.2026 über information_schema.table_privileges) — die neue Spalte ist damit ohne eigenen GRANT lesbar und
-- schreibbar. Die Zeilenregeln (Bereichsrechte, private Kontakte nur ihr Besitzer) gelten unverändert.
-- Wiederholbar.
alter table public.kunden add column if not exists verloren jsonb;
comment on column public.kunden.verloren is
  'Entgangener Klient: {grund, notiz, am, von, phaseVorher, wertNetto, vermittler} — gesetzt, solange status = verloren; Kennungen und Texte in _shared/entgangenKern.ts.';

-- Die eine Akte, die schon auf „verloren“ steht, bekommt einen Eintrag mit Grund „Sonstiges“ (Grund unbekannt),
-- damit sie auf der Seite erscheint. Datum = letzte Aktivität. Nur, wo noch nichts eingetragen ist.
update public.kunden
   set verloren = jsonb_strip_nulls(jsonb_build_object(
         'grund', 'sonstiges',
         'notiz', 'Grund nicht erfasst (vor Einführung der Seite „Entgangene Klienten“ auf verloren gesetzt).',
         'am', coalesce(nullif(left(letzte_aktivitaet::text, 10), ''), to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD')),
         'von', 'CRM',
         'wertNetto', case when jsonb_typeof(auftrag_chance->'umsatzNetto') = 'number' and (auftrag_chance->>'umsatzNetto')::numeric > 0
                           then auftrag_chance->'umsatzNetto' end,
         'vermittler', nullif(trim(vermittler->>'name'), '')
       ))
 where status = 'verloren' and verloren is null;
