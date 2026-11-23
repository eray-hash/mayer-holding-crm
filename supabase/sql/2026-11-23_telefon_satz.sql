CREATE OR REPLACE FUNCTION public.auto_nachricht_bauen(p_regel text, p_besichtigung text DEFAULT NULL::text, p_freigabe uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.auto_nachricht_regeln%rowtype;
  b public.besichtigungen%rowtype;
  f public.objekt_freigaben%rowtype;
  o public.objekte%rowtype;
  v_betreff text; v_text text;
  k_email text; k_name text; kunde text;
  an text; name text; makler text; m_tel text; m_mail text; m_eigen boolean := false;
  basis text; token text; t timestamp;
  datum text := ''; uhrzeit text := ''; angebot text := '';
  vereinbarung text; widerruf text; zugestimmt text := ''; provision text := '';
  hindernis text; werte jsonb;
  tage text[] := array['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
begin
  select * into r from auto_nachricht_regeln where id = p_regel;
  if not found then return null; end if;
  select mv.betreff, mv.text into v_betreff, v_text from mail_vorlagen mv where mv.id = r.vorlage_id;
  if coalesce(trim(v_text), '') = '' then hindernis := 'Die Mail-Vorlage „' || r.vorlage_id || '“ fehlt oder ist leer.'; end if;
  select link_basis into basis from willkommen_einstellung where id = 1;
  basis := coalesce(nullif(trim(basis), ''), 'https://eray-hash.github.io/mayer-holding-crm/');
  if right(basis, 1) <> '/' then basis := basis || '/'; end if;

  if p_besichtigung is not null then
    select * into b from besichtigungen where id = p_besichtigung;
    if not found then return null; end if;
    select * into o from objekte where id = b.objekt_id;
    if not found then return null; end if;
    kunde := b.kunde_id;
    select kk.email, coalesce(nullif(trim(kk.ansprechpartner), ''), nullif(trim(kk.firma), '')) into k_email, k_name from kunden kk where kk.id = b.kunde_id;
    an := coalesce(auto_nachricht_adresse(b.email), auto_nachricht_adresse(k_email));
    name := coalesce(nullif(trim(b.interessent), ''), k_name, '');
    makler := coalesce(nullif(trim(b.durchgefuehrt_von), ''), nullif(trim(o.verantwortlich), ''));
    t := b.beginn at time zone 'Europe/Berlin';
    datum := tage[extract(dow from t)::int + 1] || ', ' || to_char(t, 'DD.MM.YYYY');
    uhrzeit := to_char(t, 'HH24:MI') || ' Uhr';
    if b.angebot is not null then
      angebot := replace(to_char(round(b.angebot), 'FM999,999,999,990'), ',', '.') || ' €';
    end if;
    select fr.token into token from objekt_freigaben fr
      where fr.objekt_id = b.objekt_id and fr.status <> 'widerrufen' and fr.gueltig_bis > now()
        and ((an is not null and lower(fr.email) = lower(an)) or (b.kunde_id is not null and fr.kunde_id = b.kunde_id))
      order by fr.erstellt_am desc limit 1;
  elsif p_freigabe is not null then
    select * into f from objekt_freigaben where id = p_freigabe;
    if not found then return null; end if;
    select * into o from objekte where id = f.objekt_id;
    if not found then return null; end if;
    kunde := f.kunde_id;
    select kk.email, coalesce(nullif(trim(kk.ansprechpartner), ''), nullif(trim(kk.firma), '')) into k_email, k_name from kunden kk where kk.id = f.kunde_id;
    an := coalesce(auto_nachricht_adresse(f.email), auto_nachricht_adresse(k_email));
    name := coalesce(nullif(trim(f.zustimmung ->> 'name'), ''), nullif(trim(f.name), ''), k_name, '');
    makler := coalesce(nullif(trim(o.verantwortlich), ''), nullif(trim(f.erstellt_von), ''));
    token := f.token;
    provision := coalesce(f.provision, '');
    vereinbarung := auto_nachricht_klartext(f.zustimmung -> 'texte' ->> 'provision');
    widerruf := auto_nachricht_klartext(f.zustimmung -> 'texte' ->> 'widerruf');
    if f.zustimmung ? 'am' then
      zugestimmt := to_char((f.zustimmung ->> 'am')::timestamptz at time zone 'Europe/Berlin', 'DD.MM.YYYY "um" HH24:MI "Uhr"');
    end if;
    if p_regel = 'immo_portal_zustimmung' and vereinbarung is null then
      hindernis := coalesce(hindernis, 'Der Wortlaut der Provisionsvereinbarung fehlt in der gespeicherten Zustimmung.');
    end if;
  else
    return null;
  end if;

  if makler is not null then
    select mi.telefon, mi.email into m_tel, m_mail from mitarbeiter mi where mi.aktiv and lower(mi.name) = lower(makler) limit 1;
  end if;
  -- Ohne eigene Nummer: Mobilnummer aus „Mein Profil“, sonst die Firmennummer (Einstellung firmen_kontakt).
  m_eigen := nullif(trim(coalesce(m_tel, '')), '') is not null;
  m_tel := mitarbeiter_telefon(makler, m_tel);
  -- Eigene Nummer (Telefon oder Mobil aus dem Profil) → „mich“; nur die Firmennummer → „uns“ (Eray, 23.11.2026).
  if not m_eigen then m_eigen := coalesce(m_tel, '') <> '' and m_tel is distinct from firmen_telefon(); end if;

  werte := jsonb_build_object(
    'Name', name,
    'Objekt', coalesce(o.bezeichnung, ''),
    'Adresse', coalesce(trim(o.adresse), ''),
    'Termin', case when datum <> '' then datum || ', ' || uhrzeit else '' end,
    'Datum', datum,
    'Uhrzeit', uhrzeit,
    'Makler', coalesce(makler, ''),
    'Makler-Telefon', coalesce(trim(m_tel), ''),
    'Telefon-Satz', case when coalesce(trim(m_tel), '') = '' then ''
                         when m_eigen then 'Telefonisch erreichen Sie mich unter ' || trim(m_tel) || '.'
                         else 'Telefonisch erreichen Sie uns unter ' || trim(m_tel) || '.' end,
    'Makler-E-Mail', coalesce(trim(m_mail), ''),
    'Portal-Link', case when token is not null then basis || '#/formular/objekt/' || token else '' end,
    'Angebot', angebot,
    'Provision', provision,
    'Provisionsvereinbarung', coalesce(vereinbarung, ''),
    'Widerrufsbelehrung', coalesce(widerruf, ''),
    'Zugestimmt-am', zugestimmt
  );

  return jsonb_build_object(
    'objekt_id', o.id,
    'kunde_id', kunde,
    'an', an,
    'an_name', nullif(name, ''),
    'betreff', coalesce(nullif(auto_nachricht_fuellen(v_betreff, werte), ''), r.titel),
    'text', auto_nachricht_fuellen(v_text, werte),
    'privat', o.privat_besitzer is not null,
    'hindernis', hindernis
  );
end $function$
;
update mail_vorlagen set text = replace(text, 'Telefonisch erreichen Sie mich unter {{Makler-Telefon}}.', '{{Telefon-Satz}}') where id = 'mv-immo-anfrage-portallink';
select position('{{Telefon-Satz}}' in text) > 0 as umgestellt from mail_vorlagen where id = 'mv-immo-anfrage-portallink';
