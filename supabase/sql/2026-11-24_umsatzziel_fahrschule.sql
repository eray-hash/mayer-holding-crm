-- Sparte Fahrschule (Wunsch der GF, 24.11.2026): Soll 5.000 € je Monat. Bereich 'fahrschule' kommt noch ins CRM —
-- bis dahin zeigt die Sparte „wird noch eingerichtet“. Wiederholbar.
insert into public.umsatz_sparten (id, name, reihenfolge, soll_vorgabe, bereiche, stichwoerter, stichwort_aktiv, objekt_provision, rest, geaendert_von)
values ('fahrschule', 'Fahrschule', 4, 5000, array['fahrschule'], array[]::text[], false, false, false, 'Eray Yesil (Chat 24.11.2026)')
on conflict (id) do nothing;
