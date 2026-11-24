-- Rechnung ohne Zahlungsfrist (Wunsch der Geschäftsführung, 24.11.2026): Auf PDF und Mail steht dann kein „zahlbar bis“.
-- zahlungsziel bleibt intern gefüllt (Rechnungsdatum + 30 Tage, § 286 Abs. 3 BGB), damit Wiedervorlage und Mahnwesen
-- einen Prüftag haben. Wiederholbar.
alter table public.rechnungen add column if not exists ohne_zahlungsfrist boolean not null default false;
comment on column public.rechnungen.ohne_zahlungsfrist is
  'true = Rechnung nennt keine Zahlungsfrist (PDF/Mail ohne „zahlbar bis“); zahlungsziel ist dann nur der interne Prüftag (Datum + 30 Tage).';
