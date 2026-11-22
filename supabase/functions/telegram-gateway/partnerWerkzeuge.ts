// Assistent-Werkzeuge für Partner und Vermittler (22.11.2026; Oberfläche: Seite /partner im CRM und die
// Auswahl „Vermittelt durch“ in Akte und Objekt). Tabellen partner (gemeinsames Adressbuch aller aktiven
// Mitarbeiter) und partner_bezug (wer welche Akte/welches Objekt gebracht hat, mit Provision).
// Kern mit Arten, Rollen, Dubletten-Erkennung und Summen: _shared/partnerKern.ts (wie die Seite).
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregeln
// nach: Partner sieht jeder aktive Mitarbeiter; eine Zuordnung nur, wenn er die Akte (darfAkte) bzw. das
// Objekt (darfObjekt) sehen darf. Private Akten/Objekte anderer gibt es nicht („nicht gefunden“). Im
// privaten Assistenten gibt es diese Werkzeuge nicht. Löschen gibt es hier bewusst nicht.

import {
  aehnlichePartner,
  artAus,
  BEZUG_ROLLEN,
  istProvisionOffen,
  leseBetrag,
  normText,
  offeneProvision,
  PARTNER_ART_NAME,
  PARTNER_ARTEN,
  partnerName,
  PROVISION_STATUS,
  PROVISION_STATUS_NAME,
  ROLLE_NAME,
  type BezugRolle,
  type PartnerArt,
  type ProvisionStatus,
} from '../_shared/partnerKern.ts'
import { darfAkte, darfObjekt, istFremdePrivatakte, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type PartnerKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const PARTNER_WERKZEUGE = [
  {
    name: 'partner_suchen',
    description:
      'Sucht im Partner-Verzeichnis (Vermittler, Makler, Tippgeber, Notare, Steuerberater, Banken, Gutachter) nach Name, Firma, E-Mail oder Telefon, oder listet alle einer Art. Liefert die partner_id, Kontakt, vereinbarte Provision, Anzahl gebrachter Akten/Objekte und offene Provision. Mit partner_id: alle Akten und Objekte dieses Partners mit Provisionsstand. Für „Wer hat uns X vermittelt?“ nimm kunde_id bzw. objekt_id.',
    input_schema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string', description: 'Name, Firma, E-Mail oder Telefon, z. B. "Dick" oder "HD-IMMO". Leer = alle (mit art eingrenzen).' },
        art: { type: 'string', enum: [...PARTNER_ARTEN], description: 'Optional: nur diese Art.' },
        partner_id: { type: 'string', description: 'Optional: Einzelansicht dieses Partners mit allen Zuordnungen.' },
        kunde_id: { type: 'string', description: 'Optional: Welche Partner gehören zu dieser Akte?' },
        objekt_id: { type: 'string', description: 'Optional: Welche Partner gehören zu diesem Objekt?' },
        mit_inaktiven: { type: 'boolean', description: 'true = auch nicht mehr aktive Partner.' },
      },
    },
  },
  {
    name: 'partner_anlegen',
    description:
      'Legt einen neuen Partner im Verzeichnis an (Vermittler, Makler, Tippgeber, Notar, Steuerberater, Bank, Gutachter, Sonstige) — z. B. aus einer Visitenkarte oder Mail-Signatur. Prüft vorher selbst, ob es ihn schon gibt (gleiche E-Mail, Telefonnummer, Firma oder Name), und legt dann nichts an, außer trotzdem=true. Danach mit partner_zuordnen an Akte oder Objekt hängen.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name der Person, z. B. "Helmut Dick".' },
        firma: { type: 'string', description: 'Firma, z. B. "HD-IMMO". Name oder Firma muss angegeben sein.' },
        art: { type: 'string', enum: [...PARTNER_ARTEN], description: 'Art des Partners (Vorgabe vermittler).' },
        email: { type: 'string' },
        telefon: { type: 'string' },
        adresse: { type: 'string', description: 'Anschrift in einer Zeile.' },
        provision_vereinbarung: { type: 'string', description: 'Allgemein vereinbarte Provision in Worten, nur wenn genannt, z. B. "10 % vom Honorar nach Zahlungseingang".' },
        provision_satz: { type: 'number', description: 'Fester Provisionssatz in Prozent, nur wenn genannt (10 = 10 %).' },
        notiz: { type: 'string' },
        trotzdem: { type: 'boolean', description: 'true = auch anlegen, wenn es einen ähnlichen Eintrag gibt (nur nach Rückfrage).' },
      },
    },
  },
  {
    name: 'partner_zuordnen',
    description:
      'Hängt einen Partner an eine Kundenakte oder ein Objekt („Akte X hat uns Azad vermittelt“, „Objekt Y kam von Makler Dick“) oder ändert eine bestehende Zuordnung — z. B. Provision vereinbart, Betrag, oder Provision abgerechnet/bezahlt. Gibt es die Zuordnung (gleicher Partner, gleiche Akte/Objekt, gleiche Rolle) schon, werden nur die genannten Felder geändert.',
    input_schema: {
      type: 'object',
      properties: {
        partner_id: { type: 'string', description: 'Aus partner_suchen bzw. partner_anlegen.' },
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen ermitteln) — oder objekt_id.' },
        objekt_id: { type: 'string', description: 'Das Objekt (mit objekte_suchen ermitteln) — oder kunde_id.' },
        rolle: { type: 'string', enum: [...BEZUG_ROLLEN], description: 'vermittelt = hat den Kunden gebracht (Vorgabe bei Akten), angeboten = hat das Objekt angeboten (Vorgabe bei Objekten), beraten = war beratend dabei (Notar, Steuerberater, Bank, Gutachter).' },
        provision_vereinbart: { type: 'string', description: 'Für diesen Fall vereinbarte Provision in Worten, nur wenn genannt.' },
        betrag: { type: 'number', description: 'Provisionsbetrag in Euro, nur wenn genannt.' },
        provision_status: { type: 'string', enum: [...PROVISION_STATUS], description: 'keine, offen, abgerechnet oder bezahlt. Ohne Angabe: offen, sobald eine Provision oder ein Betrag genannt ist, sonst keine.' },
        notiz: { type: 'string' },
      },
      required: ['partner_id'],
    },
  },
  {
    name: 'provisionen_offen',
    description:
      'Listet die noch nicht bezahlten Provisionen an Partner (Stand offen oder abgerechnet) mit Akte/Objekt, Betrag und Summe je Partner. Für „Welche Provisionen schulden wir noch?“, „Was bekommt Azad noch?“. Nur aus Akten und Objekten, die der Mitarbeiter sehen darf.',
    input_schema: {
      type: 'object',
      properties: {
        partner_id: { type: 'string', description: 'Optional: nur dieser Partner.' },
      },
    },
  },
]

export function istPartnerWerkzeug(name: string): boolean {
  return PARTNER_WERKZEUGE.some((w) => w.name === name)
}

type PartnerZeile = {
  id: string
  name: string
  firma: string
  art: PartnerArt
  email: string | null
  telefon: string | null
  adresse: string | null
  notiz: string | null
  provision_vereinbarung: string | null
  provision_satz: number | null
  akte_id: string | null
  aktiv: boolean
}
type BezugZeile = {
  id: string
  partner_id: string
  kunde_id: string | null
  objekt_id: string | null
  rolle: BezugRolle
  provision_vereinbart: string | null
  provision_status: ProvisionStatus
  betrag: number | null
  notiz: string | null
}
type AkteZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }
type ObjektZeile = { id: string; bezeichnung: string | null; adresse: string | null; privat_besitzer: string | null }

const PARTNER_SPALTEN = 'id, name, firma, art, email, telefon, adresse, notiz, provision_vereinbarung, provision_satz, akte_id, aktiv'
const BEZUG_SPALTEN = 'id, partner_id, kunde_id, objekt_id, rolle, provision_vereinbart, provision_status, betrag, notiz'

function text(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function euro(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function akteName(a: Pick<AkteZeile, 'firma' | 'ansprechpartner'>): string {
  const f = text(a.firma)
  const p = text(a.ansprechpartner)
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

function objektName(o: Pick<ObjektZeile, 'bezeichnung' | 'adresse'>): string {
  return text(o.bezeichnung) || text(o.adresse) || 'Objekt ohne Bezeichnung'
}

/** Lädt die Akten und Objekte der Zuordnungen und behält nur, was der Mitarbeiter sehen darf. */
async function sichtbareBezuege(supabase: Supa, m: RechteMitarbeiter, liste: BezugZeile[]): Promise<{ bezuege: BezugZeile[]; ziel: (b: BezugZeile) => string }> {
  const kIds = [...new Set(liste.map((b) => b.kunde_id).filter(Boolean))] as string[]
  const oIds = [...new Set(liste.map((b) => b.objekt_id).filter(Boolean))] as string[]
  const akten = new Map<string, AkteZeile>()
  const objekte = new Map<string, ObjektZeile>()
  if (kIds.length) {
    const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', kIds)
    for (const a of (data ?? []) as AkteZeile[]) akten.set(a.id, a)
  }
  if (oIds.length) {
    const { data } = await supabase.from('objekte').select('id, bezeichnung, adresse, privat_besitzer').in('id', oIds)
    for (const o of (data ?? []) as ObjektZeile[]) objekte.set(o.id, o)
  }
  const bezuege = liste.filter((b) => {
    if (b.kunde_id) {
      const a = akten.get(b.kunde_id)
      if (!a || !darfAkte(m, a)) return false
    }
    if (b.objekt_id) {
      const o = objekte.get(b.objekt_id)
      if (!o || !darfObjekt(m, o)) return false
    }
    return true
  })
  const ziel = (b: BezugZeile) => {
    if (b.kunde_id) return `Akte ${akteName(akten.get(b.kunde_id)!)} (kunde_id=${b.kunde_id})`
    return `Objekt ${objektName(objekte.get(b.objekt_id!)!)} (objekt_id=${b.objekt_id})`
  }
  return { bezuege, ziel }
}

function provisionText(b: Pick<BezugZeile, 'provision_status' | 'betrag' | 'provision_vereinbart'>): string {
  if (b.provision_status === 'keine') return 'keine Provision'
  const teile = [`Provision ${PROVISION_STATUS_NAME[b.provision_status]}`]
  if (b.betrag !== null && b.betrag !== undefined) teile.push(euro(Number(b.betrag)))
  if (b.provision_vereinbart) teile.push(`vereinbart: ${b.provision_vereinbart}`)
  return teile.join(', ')
}

function partnerZeileText(p: PartnerZeile, eigene: BezugZeile[]): string {
  const offen = offeneProvision(eigene)
  const akten = eigene.filter((b) => b.kunde_id).length
  const objekte = eigene.filter((b) => b.objekt_id && !b.kunde_id).length
  const teile = [partnerName(p), PARTNER_ART_NAME[p.art] ?? p.art]
  if (!p.aktiv) teile.push('nicht mehr aktiv')
  const kontakt = [text(p.telefon), text(p.email)].filter(Boolean).join(', ')
  if (kontakt) teile.push(kontakt)
  if (p.provision_vereinbarung || p.provision_satz !== null) teile.push(`Provision: ${[p.provision_satz !== null ? `${String(p.provision_satz).replace('.', ',')} %` : '', text(p.provision_vereinbarung)].filter(Boolean).join(', ')}`)
  teile.push(`gebracht: ${akten} Akte(n), ${objekte} Objekt(e)`)
  if (offen.anzahl) teile.push(`offene Provision: ${euro(offen.summe)}${offen.ohneBetrag ? ` + ${offen.ohneBetrag} ohne Betrag` : ''}`)
  return `- ${teile.join(' | ')} (partner_id=${p.id})`
}

async function ladePartner(supabase: Supa, id: string): Promise<PartnerZeile | null> {
  const { data } = await supabase.from('partner').select(PARTNER_SPALTEN).eq('id', id).maybeSingle()
  return (data as PartnerZeile) ?? null
}

// deno-lint-ignore no-explicit-any
export async function fuehrePartnerWerkzeugAus(name: string, input: any, k: PartnerKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere } = k
  if (mitarbeiter.nurPrivat === true) return 'Fehler: Das Partner-Verzeichnis gibt es nur im Assistenten der Holding, nicht im privaten Assistenten.'

  if (name === 'partner_suchen') {
    const partnerId = text(input?.partner_id)
    const kundeId = text(input?.kunde_id)
    const objektId = text(input?.objekt_id)

    // Einzelansicht eines Partners
    if (partnerId) {
      const p = await ladePartner(supabase, partnerId)
      if (!p) return 'Fehler: Diesen Partner gibt es nicht. Ermittle die partner_id mit partner_suchen.'
      const { data } = await supabase.from('partner_bezug').select(BEZUG_SPALTEN).eq('partner_id', p.id).limit(2000)
      const { bezuege, ziel } = await sichtbareBezuege(supabase, mitarbeiter, (data ?? []) as BezugZeile[])
      const zeilen = [partnerZeileText(p, bezuege)]
      if (text(p.adresse)) zeilen.push(`Anschrift: ${text(p.adresse)}`)
      if (text(p.notiz)) zeilen.push(`Notiz: ${text(p.notiz).slice(0, 600)}`)
      if (p.akte_id) zeilen.push(`Eigene Akte des Partners: kunde_id=${p.akte_id}`)
      zeilen.push(bezuege.length ? 'Gebracht bzw. beteiligt:' : 'Noch keine Akten oder Objekte zugeordnet (oder nur solche, die du nicht sehen darfst).')
      for (const b of bezuege) zeilen.push(`- ${ROLLE_NAME[b.rolle]}: ${ziel(b)} | ${provisionText(b)}${b.notiz ? ` | Notiz: ${text(b.notiz).slice(0, 200)}` : ''}`)
      return zeilen.join('\n').slice(0, 12000)
    }

    // Partner einer Akte bzw. eines Objekts
    if (kundeId || objektId) {
      if (kundeId) {
        const { data: akte } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
        if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
        if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
      } else {
        const { data: obj } = await supabase.from('objekte').select('id, bezeichnung, adresse, privat_besitzer').eq('id', objektId).maybeSingle()
        if (!obj || istUnsichtbaresObjekt(mitarbeiter, obj)) return 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle sie mit objekte_suchen.'
        if (!darfObjekt(mitarbeiter, obj)) return nichtFreigegeben('immobilien', mitarbeiter.name)
      }
      const { data } = await supabase.from('partner_bezug').select(BEZUG_SPALTEN).eq(kundeId ? 'kunde_id' : 'objekt_id', kundeId || objektId).limit(200)
      const { bezuege, ziel } = await sichtbareBezuege(supabase, mitarbeiter, (data ?? []) as BezugZeile[])
      if (!bezuege.length) return `Zu ${kundeId ? 'dieser Akte' : 'diesem Objekt'} ist noch kein Partner eingetragen.`
      const ids = [...new Set(bezuege.map((b) => b.partner_id))]
      const { data: ps } = await supabase.from('partner').select(PARTNER_SPALTEN).in('id', ids)
      const nach = new Map(((ps ?? []) as PartnerZeile[]).map((p) => [p.id, p]))
      return [`Partner zu ${ziel(bezuege[0])}:`, ...bezuege.map((b) => {
        const p = nach.get(b.partner_id)
        return `- ${p ? partnerName(p) : 'unbekannt'} (${p ? PARTNER_ART_NAME[p.art] : ''}) ${ROLLE_NAME[b.rolle]} | ${provisionText(b)} (partner_id=${b.partner_id})`
      })].join('\n')
    }

    // Suche
    const begriff = text(input?.suchbegriff)
    const art = artAus(input?.art)
    let q = supabase.from('partner').select(PARTNER_SPALTEN)
    if (input?.mit_inaktiven !== true) q = q.eq('aktiv', true)
    if (art) q = q.eq('art', art)
    const { data, error } = await q.order('name', { ascending: true }).limit(2000)
    if (error) return `Fehler beim Laden: ${error.message}`
    let liste = (data ?? []) as PartnerZeile[]
    if (begriff) {
      const b = normText(begriff)
      const ziffern = begriff.replace(/\D/g, '')
      liste = liste.filter((p) =>
        [p.name, p.firma, p.email].some((x) => normText(x).includes(b)) || (ziffern.length >= 5 && String(p.telefon ?? '').replace(/\D/g, '').includes(ziffern)),
      )
    }
    if (!liste.length) return `Kein Partner gefunden${begriff ? ` zu „${begriff}“` : ''}${art ? ` (Art ${PARTNER_ART_NAME[art]})` : ''}. Neu anlegen mit partner_anlegen.`
    const gezeigt = liste.slice(0, 40)
    const { data: bz } = await supabase.from('partner_bezug').select(BEZUG_SPALTEN).in('partner_id', gezeigt.map((p) => p.id)).limit(5000)
    const { bezuege } = await sichtbareBezuege(supabase, mitarbeiter, (bz ?? []) as BezugZeile[])
    return [
      `${liste.length} Partner${begriff ? ` zu „${begriff}“` : ''}:`,
      ...gezeigt.map((p) => partnerZeileText(p, bezuege.filter((b) => b.partner_id === p.id))),
      liste.length > gezeigt.length ? `… und ${liste.length - gezeigt.length} weitere (eingrenzen).` : '',
    ].filter(Boolean).join('\n').slice(0, 12000)
  }

  if (name === 'partner_anlegen') {
    const nameText = text(input?.name)
    const firma = text(input?.firma)
    if (!nameText && !firma) return 'Fehler: name oder firma fehlt.'
    const art = artAus(input?.art) ?? 'vermittler'
    const email = text(input?.email).toLowerCase()
    const telefon = text(input?.telefon)
    const { data: alle } = await supabase.from('partner').select(PARTNER_SPALTEN).limit(5000)
    const doppelt = aehnlichePartner((alle ?? []) as PartnerZeile[], { name: nameText, firma, email, telefon })
    if (doppelt.length && input?.trotzdem !== true) {
      return `Nicht angelegt — es gibt schon ähnliche Einträge:\n${doppelt.slice(0, 5).map((p) => `- ${partnerName(p)} (${PARTNER_ART_NAME[p.art]}) (partner_id=${p.id})`).join('\n')}\nNimm einen davon (partner_zuordnen) oder frag nach und ruf partner_anlegen mit trotzdem=true auf.`
    }
    const satzRoh = input?.provision_satz
    const satz = satzRoh === undefined || satzRoh === null || satzRoh === '' ? null : Number(String(satzRoh).replace(',', '.'))
    if (satz !== null && (!Number.isFinite(satz) || satz < 0 || satz > 100)) return 'Fehler: provision_satz muss eine Zahl zwischen 0 und 100 sein.'
    const zeile = {
      name: nameText,
      firma,
      art,
      email: email || null,
      telefon: telefon || null,
      adresse: text(input?.adresse) || null,
      provision_vereinbarung: text(input?.provision_vereinbarung) || null,
      provision_satz: satz,
      notiz: String(input?.notiz ?? '').trim() || null,
      quelle: 'assistent',
      erstellt_von: mitarbeiter.name,
      geaendert_von: mitarbeiter.name,
    }
    const { data, error } = await supabase.from('partner').insert(zeile).select('id').single()
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    const anzeige = partnerName(zeile)
    protokolliere(`Partner ${anzeige} (${PARTNER_ART_NAME[art]}) angelegt`)
    return `Angelegt: ${anzeige} als ${PARTNER_ART_NAME[art]} im Partner-Verzeichnis (CRM: Seite „Partner und Vermittler“). partner_id=${data?.id ?? ''}`
  }

  if (name === 'partner_zuordnen') {
    const partnerId = text(input?.partner_id)
    const kundeId = text(input?.kunde_id)
    const objektId = text(input?.objekt_id)
    if (!partnerId) return 'Fehler: partner_id fehlt. Ermittle sie mit partner_suchen.'
    if (!kundeId && !objektId) return 'Fehler: kunde_id oder objekt_id fehlt.'
    if (kundeId && objektId) return 'Fehler: Bitte nur kunde_id oder objekt_id angeben, nicht beides.'
    const p = await ladePartner(supabase, partnerId)
    if (!p) return 'Fehler: Diesen Partner gibt es nicht. Ermittle die partner_id mit partner_suchen.'

    let zielText = ''
    if (kundeId) {
      const { data: akte } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
      if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
      if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
      zielText = `der Akte ${akteName(akte)}`
    } else {
      const { data: obj } = await supabase.from('objekte').select('id, bezeichnung, adresse, privat_besitzer').eq('id', objektId).maybeSingle()
      if (!obj || istUnsichtbaresObjekt(mitarbeiter, obj)) return 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle sie mit objekte_suchen.'
      if (!darfObjekt(mitarbeiter, obj)) return nichtFreigegeben('immobilien', mitarbeiter.name)
      zielText = `dem Objekt ${objektName(obj)}`
    }

    const rolleRoh = text(input?.rolle)
    if (rolleRoh && !(BEZUG_ROLLEN as readonly string[]).includes(rolleRoh)) return `Fehler: rolle muss ${BEZUG_ROLLEN.join(', ')} sein.`
    const rolle: BezugRolle = (rolleRoh as BezugRolle) || (objektId ? 'angeboten' : p.art === 'notar' || p.art === 'steuerberater' || p.art === 'bank' || p.art === 'gutachter' ? 'beraten' : 'vermittelt')
    const statusRoh = text(input?.provision_status)
    if (statusRoh && !(PROVISION_STATUS as readonly string[]).includes(statusRoh)) return `Fehler: provision_status muss ${PROVISION_STATUS.join(', ')} sein.`
    const betragRoh = input?.betrag
    const betrag = betragRoh === undefined || betragRoh === null || betragRoh === '' ? undefined : leseBetrag(betragRoh)
    if (betragRoh !== undefined && betragRoh !== null && betragRoh !== '' && betrag === undefined) return 'Fehler: betrag ist keine gültige Zahl.'
    const vereinbart = input?.provision_vereinbart === undefined ? undefined : text(input.provision_vereinbart)
    const notiz = input?.notiz === undefined ? undefined : String(input.notiz ?? '').trim()

    // Frisch lesen: gibt es die Zuordnung schon?
    const { data: vorhandene } = await supabase.from('partner_bezug').select(BEZUG_SPALTEN).eq('partner_id', p.id).eq(kundeId ? 'kunde_id' : 'objekt_id', kundeId || objektId).eq('rolle', rolle).limit(1)
    const alt = ((vorhandene ?? []) as BezugZeile[])[0]

    if (alt) {
      const patch: Record<string, unknown> = {}
      if (vereinbart !== undefined && vereinbart !== text(alt.provision_vereinbart)) patch.provision_vereinbart = vereinbart || null
      if (betrag !== undefined && Number(alt.betrag ?? NaN) !== betrag) patch.betrag = betrag
      if (notiz !== undefined && notiz !== String(alt.notiz ?? '').trim()) patch.notiz = notiz || null
      let status = statusRoh as ProvisionStatus | ''
      if (!status && alt.provision_status === 'keine' && (patch.provision_vereinbart || (betrag ?? 0) > 0)) status = 'offen'
      if (status && status !== alt.provision_status) patch.provision_status = status
      if (!Object.keys(patch).length) return `Schon so eingetragen: ${partnerName(p)} ${ROLLE_NAME[rolle]} bei ${zielText} — ${provisionText(alt)}.`
      patch.geaendert_von = mitarbeiter.name
      const { error } = await supabase.from('partner_bezug').update(patch).eq('id', alt.id)
      if (error) return `Fehler beim Speichern: ${error.message}`
      const neu = { ...alt, ...patch } as BezugZeile
      protokolliere(`Zuordnung ${partnerName(p)} bei ${zielText} geändert (${provisionText(neu)})`)
      return `Geändert: ${partnerName(p)} ${ROLLE_NAME[rolle]} bei ${zielText} — ${provisionText(neu)}. id=${alt.id}`
    }

    const status: ProvisionStatus = (statusRoh as ProvisionStatus) || (vereinbart || (betrag ?? 0) > 0 ? 'offen' : 'keine')
    const zeile = {
      partner_id: p.id,
      kunde_id: kundeId || null,
      objekt_id: objektId || null,
      rolle,
      provision_vereinbart: vereinbart || null,
      provision_status: status,
      betrag: betrag ?? null,
      notiz: notiz || null,
      quelle: 'assistent',
      erstellt_von: mitarbeiter.name,
      geaendert_von: mitarbeiter.name,
    }
    const { data, error } = await supabase.from('partner_bezug').insert(zeile).select('id').single()
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde zugeordnet.`
    protokolliere(`${partnerName(p)} bei ${zielText} eingetragen (${ROLLE_NAME[rolle]})`)
    const ohneProvision = status === 'keine' && (p.provision_vereinbarung || p.provision_satz !== null) ? ` Hinweis: Mit diesem Partner ist allgemein „${[p.provision_satz !== null ? `${p.provision_satz} %` : '', text(p.provision_vereinbarung)].filter(Boolean).join(', ')}“ vereinbart — soll für diesen Fall eine Provision offen sein?` : ''
    return `Eingetragen: ${partnerName(p)} ${ROLLE_NAME[rolle]} bei ${zielText} — ${provisionText(zeile)}. Im CRM unter „Vermittelt durch“ und auf der Seite „Partner und Vermittler“.${ohneProvision} id=${data?.id ?? ''}`
  }

  if (name === 'provisionen_offen') {
    const partnerId = text(input?.partner_id)
    let q = supabase.from('partner_bezug').select(BEZUG_SPALTEN).in('provision_status', ['offen', 'abgerechnet'])
    if (partnerId) q = q.eq('partner_id', partnerId)
    const { data, error } = await q.limit(5000)
    if (error) return `Fehler beim Laden: ${error.message}`
    const { bezuege, ziel } = await sichtbareBezuege(supabase, mitarbeiter, ((data ?? []) as BezugZeile[]).filter((b) => istProvisionOffen(b.provision_status)))
    if (!bezuege.length) return partnerId ? 'Für diesen Partner ist keine Provision offen.' : 'Es sind keine Provisionen an Partner offen.'
    const ids = [...new Set(bezuege.map((b) => b.partner_id))]
    const { data: ps } = await supabase.from('partner').select(PARTNER_SPALTEN).in('id', ids)
    const nach = new Map(((ps ?? []) as PartnerZeile[]).map((p) => [p.id, p]))
    const gesamt = offeneProvision(bezuege)
    const gruppen = ids
      .map((id) => ({ id, p: nach.get(id), liste: bezuege.filter((b) => b.partner_id === id) }))
      .map((g) => ({ ...g, offen: offeneProvision(g.liste) }))
      .sort((a, b) => b.offen.summe - a.offen.summe)
    const zeilen = [`Offene Provisionen an Partner: ${euro(gesamt.summe)} aus ${gesamt.anzahl} Fall/Fällen${gesamt.ohneBetrag ? `, davon ${gesamt.ohneBetrag} noch ohne Betrag` : ''}.`]
    for (const g of gruppen) {
      zeilen.push(`${g.p ? partnerName(g.p) : 'unbekannt'}: ${euro(g.offen.summe)}${g.offen.ohneBetrag ? ` + ${g.offen.ohneBetrag} ohne Betrag` : ''} (partner_id=${g.id})`)
      for (const b of g.liste) zeilen.push(`  - ${ziel(b)} | ${provisionText(b)} (id=${b.id})`)
    }
    return zeilen.join('\n').slice(0, 12000)
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
