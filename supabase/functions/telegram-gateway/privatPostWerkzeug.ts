// Assistent-Werkzeug für die Vorschläge im eigenen, privaten Postfach (22.11.2026). Die Vorschläge berechnet der Server
// im Minutentakt (email-gateway/privatPostZuordnung.ts) und legt sie in eingegangene_emails.zuordnung_vorschlag ab
// (art 'privat', Status 'privat_offen' / 'privat_rundschreiben' …). Im CRM: Privat → Mein Postfach.
//
// Alles ist an die eigene Adresse des fragenden Mitarbeiters gebunden (besitzer_email = seine Login-Adresse), nie an
// eine Angabe aus dem Gespräch. Der Assistent arbeitet mit Dienstrechten, deshalb bildet diese Datei die Regeln der
// Datenbank nach: private Mails nur des Besitzers, private Kontakte nur des Besitzers, Akten der Holding nur mit
// Bereichsrecht (rechte.ts, für das Ziel einer Übergabe ohne die Einschränkung des privaten Assistenten).
//
// Annehmen:
//  - Akte der Holding → die Mail wird ins CRM übergeben (email-gateway mail_freigeben, wie „In den öffentlichen
//    Bereich holen“) und dann der Akte zugeordnet (mail_zuordnen: Verlaufseintrag, Anhänge in die Dokumente).
//    Vorher wird der Vorschlag geleert, damit Namen privater Kontakte nicht mit ins gemeinsame Postfach wandern.
//  - eigener privater Kontakt → die Mail bleibt privat und wird nur bei ihm abgelegt (zugewiesener_kunde_id), mit
//    Verlaufseintrag beim Kontakt. Geht der Kontakt später ins Mayer-CRM, wandert die Mail mit (kontaktUebernahme.ts).

import { darfAkte, istEigene, ohneNurPrivat, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

const BERLIN_TAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

/** Kalendertag in deutscher Ortszeit (JJJJ-MM-TT). Vorher die ersten 10 Zeichen des UTC-Zeitstempels: Mails
 *  zwischen Mitternacht und 1 bzw. 2 Uhr bekamen den Vortag (23 Mails im Bestand, 23.11.2026). */
export function berlinTag(zeitpunkt: string | null | undefined): string {
  const d = new Date(String(zeitpunkt ?? ''))
  return Number.isNaN(d.getTime()) ? String(zeitpunkt ?? '').slice(0, 10) : BERLIN_TAG.format(d)
}

export type PrivatPostKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Aufruf der Mail-Funktion (email-gateway) mit Dienst-Schlüssel; wirft bei Fehler mit der Meldung des Servers.
   *  In index.ts: callEmailGateway. Ohne Angabe ruft das Werkzeug die Funktion selbst auf. */
  mailFunktion?: (action: string, body: Record<string, unknown>) => Promise<any>
}

export const PRIVAT_POST_WERKZEUGE = [
  {
    name: 'meine_post_vorschlaege',
    description:
      'Vorschläge für das EIGENE private Postfach des Mitarbeiters, mit dem du sprichst (nur seine Mails, niemand sonst sieht sie): Das CRM vermutet für viele private Mails, zu welcher Akte sie gehören, und erkennt Rundschreiben. aktion=liste zeigt offene Vorschläge (mail_id, Absender, Betreff, Kandidaten mit kunde_id, ob privater Kontakt, ob sicher) und wie viele Rundschreiben ausgeblendet sind. aktion=annehmen legt eine Mail ab: bei einer Akte der Holding wird sie dabei ins CRM übergeben (danach sehen sie die Kollegen dieses Bereichs — vorher nachfragen und erst nach seinem klaren Ja ausführen); bei einem eigenen privaten Kontakt bleibt sie privat. aktion=verwerfen: keiner der Vorschläge passt. Die Kennungen stammen aus aktion=liste.',
    input_schema: {
      type: 'object',
      properties: {
        aktion: { type: 'string', enum: ['liste', 'annehmen', 'verwerfen'] },
        mail_id: { type: 'string', description: 'Bei annehmen/verwerfen: mail_id aus der Liste.' },
        kunde_id: { type: 'string', description: 'Bei annehmen: die gewählte Akte (kunde_id eines Kandidaten oder eine andere Akte bzw. ein eigener privater Kontakt). Ohne Angabe nur, wenn es genau einen Kandidaten gibt.' },
        suche: { type: 'string', description: 'Bei liste, optional: Absender oder Wort aus dem Betreff.' },
      },
      required: ['aktion'],
    },
  },
]

export function istPrivatPostWerkzeug(name: string): boolean {
  return PRIVAT_POST_WERKZEUGE.some((w) => w.name === name)
}

type Kandidat = { kundeId: string; bereich: string; name: string; grund: string; privat?: boolean; sicher?: boolean }
type Vorschlag = { art?: string; status?: string; kandidaten?: Kandidat[]; grund?: string } & Record<string, unknown>
type MailZeile = {
  id: string
  message_id: string | null
  von: string | null
  von_name: string | null
  betreff: string | null
  mail_datum: string | null
  ignoriert: boolean | null
  zugewiesener_kunde_id: string | null
  zuordnung_vorschlag: Vorschlag | null
}
type Akte = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null; activities?: unknown[] | null }

const TAG_MS = 86_400_000

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

/** Darf der Besitzer diese Akte als Ziel wählen? Private: nur eigene. Holding: Bereichsrecht (auch im privaten Assistenten), keine Sammelakten. */
export function darfZiel(m: RechteMitarbeiter, a: Akte): boolean {
  if (a.bereich === 'privat') return istEigene(m, a.verantwortlich_email)
  if (SAMMELAKTEN.includes(a.id)) return false
  return darfAkte(ohneNurPrivat(m), a)
}

function istPrivatVorschlag(v: unknown, status?: string): v is Vorschlag {
  if (!v || typeof v !== 'object') return false
  const x = v as Vorschlag
  return x.art === 'privat' && (!status || x.status === status)
}

async function standardMailFunktion(action: string, body: Record<string, unknown>): Promise<any> {
  const geheim = Deno.env.get('CRM_SHARED_SECRET')
  const antwort = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, ...(geheim ? { 'x-crm-secret': geheim } : {}) },
    body: JSON.stringify({ action, ...body }),
  })
  const daten = await antwort.json().catch(() => ({}))
  if (!antwort.ok) throw new Error(daten?.error ?? `Mail-Funktion antwortet mit Fehler ${antwort.status}`)
  return daten
}

/** Die eigenen privaten Mails der letzten 30 Tage, die noch bei keiner Akte liegen (mit Vorschlag). */
async function ladeEigene(supabase: Supa, ich: string, heute: string): Promise<MailZeile[]> {
  const seit = new Date(Date.parse(`${heute}T00:00:00Z`) - 30 * TAG_MS).toISOString()
  const { data, error } = await supabase
    .from('eingegangene_emails')
    .select('id, message_id, von, von_name, betreff, mail_datum, ignoriert, zugewiesener_kunde_id, zuordnung_vorschlag')
    .eq('besitzer_email', ich)
    .is('zugewiesener_kunde_id', null)
    .gte('erstellt_am', seit)
    .order('mail_datum', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as MailZeile[]
}

async function ladeEine(supabase: Supa, ich: string, mailId: string): Promise<MailZeile | null> {
  const spalten = 'id, message_id, von, von_name, betreff, mail_datum, ignoriert, zugewiesener_kunde_id, zuordnung_vorschlag'
  const istKennung = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mailId)
  const { data } = await supabase.from('eingegangene_emails').select(spalten).eq(istKennung ? 'id' : 'message_id', mailId).eq('besitzer_email', ich).limit(1).maybeSingle()
  return (data ?? null) as MailZeile | null
}

// deno-lint-ignore no-explicit-any
export async function fuehrePrivatPostWerkzeugAus(werkzeug: string, input: any, k: PrivatPostKontext): Promise<string> {
  if (werkzeug !== 'meine_post_vorschlaege') return `Fehler: Unbekanntes Werkzeug ${werkzeug}.`
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const ich = String(mitarbeiter.email ?? '').trim().toLowerCase()
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt — sein privates Postfach lässt sich nicht zuordnen.'
  const aktion = String(input?.aktion ?? 'liste')

  if (aktion === 'liste') {
    let mails: MailZeile[]
    try {
      mails = await ladeEigene(supabase, ich, heute)
    } catch (err) {
      return `Fehler beim Lesen des privaten Postfachs: ${err instanceof Error ? err.message : String(err)}`
    }
    const rundschreiben = mails.filter((m) => !m.ignoriert && istPrivatVorschlag(m.zuordnung_vorschlag, 'privat_rundschreiben')).length
    const suche = String(input?.suche ?? '').trim().toLowerCase()
    let offen = mails.filter((m) => !m.ignoriert && istPrivatVorschlag(m.zuordnung_vorschlag, 'privat_offen'))
    if (suche) offen = offen.filter((m) => `${m.von ?? ''} ${m.von_name ?? ''} ${m.betreff ?? ''}`.toLowerCase().includes(suche))
    if (offen.length === 0) {
      return `Keine offenen Vorschläge im privaten Postfach${suche ? ' zu dieser Suche' : ''}. ${rundschreiben} Rundschreiben/automatische Meldungen sind in der Ansicht ausgeblendet (CRM: Privat → Mein Postfach).`
    }
    // Kandidaten frisch gegen die Rechte prüfen (Rechte können sich seit dem Vorschlag geändert haben).
    const ids = [...new Set(offen.flatMap((m) => (m.zuordnung_vorschlag?.kandidaten ?? []).map((x) => x.kundeId)))]
    const { data: akten } = ids.length ? await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', ids) : { data: [] }
    const erlaubt = new Map(((akten ?? []) as Akte[]).filter((a) => darfZiel(mitarbeiter, a)).map((a) => [a.id, a]))
    const zeilen = offen
      .map((m) => ({
        mail_id: m.message_id ?? m.id,
        von: `${m.von_name ?? ''} <${m.von ?? ''}>`.trim(),
        betreff: m.betreff ?? '(ohne Betreff)',
        datum: berlinTag(m.mail_datum),
        kandidaten: (m.zuordnung_vorschlag?.kandidaten ?? [])
          .filter((x) => erlaubt.has(x.kundeId))
          .map((x) => ({ kunde_id: x.kundeId, name: akteName(erlaubt.get(x.kundeId)!), privater_kontakt: erlaubt.get(x.kundeId)!.bereich === 'privat', sicher: x.sicher === true, grund: x.grund })),
      }))
      .filter((z) => z.kandidaten.length > 0)
    if (zeilen.length === 0) return `Keine offenen Vorschläge mit Akten, die dieser Mitarbeiter sehen darf. ${rundschreiben} Rundschreiben sind ausgeblendet.`
    return JSON.stringify({ offen: zeilen.length, rundschreiben_ausgeblendet: rundschreiben, vorschlaege: zeilen.slice(0, 15) })
  }

  const mailId = String(input?.mail_id ?? '').trim()
  if (!mailId) return 'Fehler: mail_id fehlt. Hol sie mit aktion=liste.'
  const mail = await ladeEine(supabase, ich, mailId)
  if (!mail) return 'Fehler: Diese Mail liegt nicht im privaten Postfach dieses Mitarbeiters.'
  if (mail.zugewiesener_kunde_id) return 'Fehler: Diese Mail ist schon bei einer Akte abgelegt.'
  const betreff = mail.betreff ?? '(ohne Betreff)'
  const jetzt = new Date().toISOString()

  if (aktion === 'verwerfen') {
    const { error } = await supabase
      .from('eingegangene_emails')
      .update({ zuordnung_vorschlag: { art: 'privat', status: 'privat_verworfen', erledigt_am: jetzt, erledigt_von: mitarbeiter.name } })
      .eq('id', mail.id)
      .eq('besitzer_email', ich)
    if (error) return `Fehler: ${error.message}`
    protokolliere(`Vorschlag zur privaten Mail „${betreff}" verworfen`)
    return `Erledigt: Der Vorschlag zu „${betreff}" ist verworfen. Die Mail bleibt im privaten Postfach.`
  }

  if (aktion !== 'annehmen') return 'Fehler: aktion muss liste, annehmen oder verwerfen sein.'

  const kandidaten = istPrivatVorschlag(mail.zuordnung_vorschlag) ? mail.zuordnung_vorschlag.kandidaten ?? [] : []
  let kundeId = String(input?.kunde_id ?? '').trim()
  if (!kundeId) {
    if (kandidaten.length !== 1) return `Fehler: Bitte kunde_id angeben — ${kandidaten.length === 0 ? 'zu dieser Mail gibt es keinen Vorschlag' : `es gibt ${kandidaten.length} Kandidaten`}.`
    kundeId = kandidaten[0].kundeId
  }
  const { data: akteRoh } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email, activities').eq('id', kundeId).maybeSingle()
  const akte = akteRoh as Akte | null
  // Private Kontakte anderer gibt es für ihn nicht — gleiche Meldung wie „nicht vorhanden“.
  if (!akte || (akte.bereich === 'privat' && !istEigene(mitarbeiter, akte.verantwortlich_email))) return 'Fehler: Diese Akte gibt es nicht.'
  if (!darfZiel(mitarbeiter, akte)) return 'Fehler: Diese Akte liegt in einem Bereich, der für diesen Mitarbeiter nicht freigegeben ist.'
  const name = akteName(akte)

  if (akte.bereich === 'privat') {
    // Bleibt privat: nur beim eigenen Kontakt ablegen.
    const { data: geaendert, error } = await supabase
      .from('eingegangene_emails')
      .update({
        zugewiesener_kunde_id: akte.id,
        zugewiesener_bereich: 'privat',
        zugewiesener_kunde_name: name,
        zuordnung_vorschlag: { art: 'privat', status: 'privat_uebernommen', erledigt_am: jetzt, erledigt_von: mitarbeiter.name, kundeId: akte.id },
      })
      .eq('id', mail.id)
      .eq('besitzer_email', ich)
      .is('zugewiesener_kunde_id', null)
      .select('id')
    if (error) return `Fehler: ${error.message}`
    if (!geaendert?.length) return 'Fehler: Die Mail hat sich inzwischen geändert (schon abgelegt oder übergeben).'
    // Verlauf frisch lesen und ergänzen.
    const { data: frisch } = await supabase.from('kunden').select('activities').eq('id', akte.id).eq('bereich', 'privat').maybeSingle()
    const eintrag = { id: crypto.randomUUID(), date: heute, text: `Private E-Mail abgelegt: „${betreff}" von ${mail.von_name || mail.von || 'unbekannt'}`, user: mitarbeiter.name }
    const { error: verlaufFehler } = await supabase
      .from('kunden')
      .update({ activities: [eintrag, ...(((frisch?.activities ?? []) as unknown[]))], letzte_aktivitaet: heute })
      .eq('id', akte.id)
      .eq('bereich', 'privat')
    protokolliere(`Private Mail „${betreff}" beim privaten Kontakt ${name} abgelegt (kunde_id=${akte.id})`)
    return `Erledigt: „${betreff}" liegt jetzt beim privaten Kontakt ${name} und bleibt privat.${verlaufFehler ? ' Der Verlaufseintrag beim Kontakt fehlt (Fehler beim Speichern).' : ''}`
  }

  if (!mail.message_id) return 'Fehler: Diese Mail hat keine Nachrichtenkennung und lässt sich nicht übergeben.'
  // Erst den Vorschlag leeren (Namen privater Kontakte dürfen nicht mit ins gemeinsame Postfach), dann übergeben.
  const vorher = mail.zuordnung_vorschlag
  await supabase
    .from('eingegangene_emails')
    .update({ zuordnung_vorschlag: { art: 'privat', status: 'privat_uebernommen', erledigt_am: jetzt, erledigt_von: mitarbeiter.name, kundeId: akte.id } })
    .eq('id', mail.id)
    .eq('besitzer_email', ich)
  const rufe = k.mailFunktion ?? standardMailFunktion
  try {
    await rufe('mail_freigeben', { art: 'eingang', id: mail.message_id, imAuftragVon: ich })
  } catch (err) {
    await supabase.from('eingegangene_emails').update({ zuordnung_vorschlag: vorher }).eq('id', mail.id).eq('besitzer_email', ich)
    return `Fehler beim Übergeben ins CRM: ${err instanceof Error ? err.message : String(err)}`
  }
  protokolliere(`Private Mail „${betreff}" ins CRM übergeben`)
  try {
    const r = await rufe('mail_zuordnen', { mailId: mail.id, kundeId: akte.id, imAuftragVon: ich })
    protokolliere(`Mail „${betreff}" der Akte ${name} zugeordnet (kunde_id=${akte.id})`)
    const abgelegt = Number(r?.abgelegt ?? 0)
    return `Erledigt: „${betreff}" ist ins CRM übergeben und liegt bei ${name} (kunde_id=${akte.id}).${abgelegt > 0 ? ` ${abgelegt === 1 ? '1 Anhang liegt' : `${abgelegt} Anhänge liegen`} in den Dokumenten der Akte.` : ''} Die Kollegen dieses Bereichs sehen die Mail jetzt.`
  } catch (err) {
    return `Fehler: Die Mail ist ins gemeinsame Postfach übergeben, aber die Zuordnung zu ${name} hat nicht geklappt (${err instanceof Error ? err.message : String(err)}). Bitte im CRM im gemeinsamen Postfach der Akte zuordnen.`
  }
}
