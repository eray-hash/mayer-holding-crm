-- Selbst angelegte, frische Akte selbst löschen (Wunsch 25.11.2026) — NOCH NICHT AUSGEFÜHRT.
-- Gleiche Regel wie supabase/functions/_shared/akteSelbstLoeschen.ts (Telegram kunde_loeschen und
-- src/components/LoeschenKundeButton.tsx). Bisher durfte nur die Geschäftsführung Holding-Akten löschen
-- (Regel „kunden loeschen (GF)“); die bleibt unverändert, diese Regel kommt dazu.
--
-- Darf löschen, wer aktiver Mitarbeiter ist und
--   - die älteste Verlaufszeile nennt ihn (user = sein Name) ODER verantwortlich = sein Name ODER
--     verantwortlich_email = seine Adresse,
--   - die älteste Verlaufszeile ist höchstens 14 Tage alt,
--   - an der Akte hängen keine Rechnungen (damit keine Zahlungen), keine Kostenvoranschläge, keine Protokolle,
--   - nicht die Sammelakten, nicht Bereich privat (dafür gibt es die eigene Regel).
-- Die Bereichsregel rechte_bereich_kunden gilt zusätzlich weiter.

create or replace function public.darf_akte_selbst_loeschen(p_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with ich as (
    select m.name, lower(m.email) as email
    from public.mitarbeiter m
    where m.email = auth.jwt()->>'email' and m.aktiv
    limit 1
  ),
  akte as (
    select k.id, k.verantwortlich, lower(coalesce(k.verantwortlich_email, '')) as verantwortlich_email, k.activities
    from public.kunden k
    where k.id = p_id
      and k.bereich <> 'privat'
      and k.id not in ('k_intern_holding', 'k_eingang_ungeklaert')
  ),
  erste as (
    select a->>'user' as wer, (a->>'date')::date as tag
    from akte, jsonb_array_elements(case when jsonb_typeof(akte.activities) = 'array' then akte.activities else '[]'::jsonb end) a
    where (a->>'date') ~ '^\d{4}-\d{2}-\d{2}'
    order by (a->>'date')::date asc
    limit 1
  )
  select exists (
    select 1
    from ich, akte, erste
    where erste.tag >= (now() at time zone 'Europe/Berlin')::date - 14
      and (
        lower(coalesce(erste.wer, '')) = lower(ich.name)
        or lower(coalesce(akte.verantwortlich, '')) = lower(ich.name)
        or (akte.verantwortlich_email <> '' and akte.verantwortlich_email = ich.email)
      )
      and not exists (select 1 from public.rechnungen r where r.kunde_id = akte.id)
      and not exists (select 1 from public.kostenvoranschlaege kv where kv.kunde_id = akte.id)
      and not exists (select 1 from public.protokolle p where p.kunde_id = akte.id)
  );
$$;

revoke all on function public.darf_akte_selbst_loeschen(text) from public, anon;
grant execute on function public.darf_akte_selbst_loeschen(text) to authenticated;

drop policy if exists "kunden loeschen (Ersteller, frisch)" on public.kunden;
create policy "kunden loeschen (Ersteller, frisch)" on public.kunden
  for delete
  using (bereich <> 'privat' and public.darf_akte_selbst_loeschen(id));
