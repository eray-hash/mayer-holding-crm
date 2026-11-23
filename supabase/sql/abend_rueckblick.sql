-- Abend-Rückblick im Mayer-Bot für alle Mitarbeiter (23.11.2026, email-gateway/abendRueckblick.ts) — NICHT automatisch
-- ausführen. Wiederholbar (if not exists). Voraussetzung: Teil B aus runde6_klein.sql (Tabellen assistent_hinweis_einstellung
-- und assistent_hinweise) ist ausgeführt.
--
-- Solange diese Datei nicht ausgeführt ist, sendet der Rückblick nichts (Schalter nicht lesbar → 'aus').

-- 1) Gemeinsamer Schalter und Uhrzeit (eine Zeile, id 1):
--    'aus'       = nichts wird gesendet,
--    'superuser' = Probelauf (Vorgabe): nur Mitarbeiter mit ist_superuser (Eray) bekommen ihren eigenen Rückblick und
--                  in einer zweiten Nachricht, was an die Kollegen „ginge an …“ (dort ohne Knöpfe),
--    'alle'      = an alle mit verbundenem Telegram (erst nach Erays Freigabe der Texte umstellen).
--    Uhrzeit: werktags ab dieser Uhrzeit bis 90 Minuten danach (Berliner Zeit), erlaubt 12:00–22:00.
alter table public.assistent_hinweis_einstellung
  add column if not exists abend_rueckblick text not null default 'superuser'
    check (abend_rueckblick in ('aus', 'superuser', 'alle'));
alter table public.assistent_hinweis_einstellung
  add column if not exists abend_rueckblick_uhrzeit text not null default '17:30'
    check (abend_rueckblick_uhrzeit ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- 2) Je Mitarbeiter: abschalten (keine Zeile oder true = an) und Tag des letzten Rückblicks (höchstens einmal am Tag).
--    Abschalten per Assistent: „Abend-Rückblick aus“ (Werkzeug abend_rueckblick_einstellen).
alter table public.assistent_hinweise add column if not exists abend_rueckblick boolean not null default true;
alter table public.assistent_hinweise add column if not exists abend_rueckblick_tag date;

-- Rechte: unverändert aus runde6_klein.sql (Einstellung: lesen für aktive Mitarbeiter, schreiben nur der Server;
-- je Mitarbeiter: nur die eigene Zeile). Neue Spalten erben die Tabellenrechte.

-- =====================================================================================================
-- Umschalten (nur nach Erays Ja)
-- =====================================================================================================
-- Nach Freigabe der Texte an alle:
--   update public.assistent_hinweis_einstellung set abend_rueckblick = 'alle', geaendert_von = 'eray', geaendert_am = now() where id = 1;
-- Andere Uhrzeit:
--   update public.assistent_hinweis_einstellung set abend_rueckblick_uhrzeit = '17:00', geaendert_am = now() where id = 1;
-- Ganz aus:
--   update public.assistent_hinweis_einstellung set abend_rueckblick = 'aus', geaendert_am = now() where id = 1;

-- =====================================================================================================
-- Prüfabfragen (nur lesen)
-- =====================================================================================================
-- select abend_rueckblick, abend_rueckblick_uhrzeit from public.assistent_hinweis_einstellung;
-- select email, abend_rueckblick, abend_rueckblick_tag from public.assistent_hinweise order by email;
-- Wer bekommt stattdessen „Offen geblieben“ (Tagesablauf-Abend) und damit keinen Rückblick:
-- select email from public.tagesplan_einstellungen where abend_an;
