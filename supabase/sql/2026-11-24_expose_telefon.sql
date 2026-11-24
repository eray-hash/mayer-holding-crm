-- „Telefonnummer im Exposé zeigen“ (24.11.2026): Einstellung je Mitarbeiter in „Mein Profil“.
-- Liegt bewusst in mitarbeiter_profil (nicht in mitarbeiter): dort gelten Rechte auf die ganze Tabelle,
-- die neue Spalte ist also sofort lesbar/schreibbar; die Zeilenregel (nur eigene Zeile) gilt weiter.
-- Vorgabe true: für alle, die nichts einstellen, ändert sich nichts.

alter table public.mitarbeiter_profil
  add column if not exists telefon_im_expose boolean not null default true;

-- Nur zur Sicherheit (Tabellenrechte bestehen bereits); schadet nicht, falls doppelt.
grant select (telefon_im_expose), insert (telefon_im_expose), update (telefon_im_expose) on public.mitarbeiter_profil to authenticated;
