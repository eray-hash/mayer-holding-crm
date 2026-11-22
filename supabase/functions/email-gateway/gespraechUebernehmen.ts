// Gesprächs-App „Mayer Gespräch“ (22.11.2026): Übernahme einer fertigen Auswertung in die Kundenakte, Akte
// zuordnen bzw. neu anlegen und das Briefing vor einem Termin. Drei Aktionen im email-gateway:
//
// - gespraech_uebernehmen {id, auswahl, bearbeitet?}: Der Mitarbeiter hat auf dem Prüfbildschirm der App
//   (src/gespraech/auswertung/AuswertungSeite.tsx) die Vorschläge der Auswertung (Spalte analyse) angesehen,
//   geändert und angehakt. Angelegt wird:
//     · immer das Gesprächsprotokoll (Tabelle protokolle, Felder wie telegram-gateway/nachTerminWerkzeug.ts und
//       „Gespräch aufzeichnen“ im CRM: ki_zusammenfassung, kernthemen, vereinbarungen, offene_punkte, stimmung,
//       dauer_sekunden; text = gegliederte Fassung mit Abschrift) und ein Verlaufseintrag in der Akte,
//     · wahlweise „Nächste Schritte“ der Akte (ersetzt, der alte Text steht danach im Verlauf),
//     · Wiedervorlagen (quelle 'hand' — die Tabelle kennt nur 'hand' und 'regel'; Herkunft steht in der Notiz),
//     · To-dos über todo_anlegen des Assistenten (eigene Liste oder die Liste eines Kollegen, „(von …)“),
//     · Termine im Kalender des Besitzers über kalender.ts speichereTermin (ohne Einladung an den Kunden),
//     · Stammdaten: leeres Feld der Akte → ergänzt (mit Verlaufseintrag), sonst ein Vorschlag in
//       kunden.stammdaten_vorschlaege (Format _shared/stammdatenVorschlag.ts, Zusatz quelle 'gespraech') —
//       überschrieben wird nie. Firma, Ansprechpartner und Sonstiges gibt es dort nicht: Verlaufsnotiz.
//     · Audio (und wahlweise Fotos) als Dokumente der Akte (Kopie der Teilstücke, keine Zusammenführung;
//       über HOECHSTENS_AUDIO_BYTES wird das Audio übersprungen und das gesagt),
//     · den Mail-Entwurf als Verlaufseintrag — verschickt wird hier nichts.
//   Wiederholbar ohne Doppelte: Was angelegt wurde, steht in gespraech_aufnahmen.uebernommen (Schema
//   GespraechUebernommen in src/gespraech/typen.ts, je Liste Index → id). Ein zweiter Aufruf legt nur an,
//   was noch fehlt. Das Protokoll hat eine feste Kennung je Aufnahme; ein gleichzeitiger zweiter Aufruf
//   scheitert daran und bekommt 409.
// - gespraech_akte_setzen {id, kundeId} oder {id, neu:{bereich, firma, ansprechpartner?, telefon?, email?}}:
//   verknüpft die Aufnahme mit einer Akte bzw. legt eine neue an (Felder wie kunde_anlegen im Assistenten).
// - gespraech_vorbereitung {terminId? | kundeId? | objektId?, punkte?}: Briefing wie das Termin-Briefing
//   (_shared/terminBriefingKern.ts), als Daten für die App. Schreibt nichts.
//
// Rechte: nur der Besitzer der Aufnahme, und er muss die Akte sehen dürfen (darfKunde aus index.ts).
// Die Datei kennt index.ts nicht: Rechteprüfungen reicht der Aufrufer als Funktionen herein.

import type { Aufrufer } from './postfach.ts'
import { speichereTermin, type TerminEingabe } from './kalender.ts'
import { alsVorschlaege, gleicherWert, haengeAn, type StammdatenFeld, type StammdatenVorschlag } from '../_shared/stammdatenVorschlag.ts'
import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { berlinZeitZuUtc, todoAnlegen } from '../telegram-gateway/teamWerkzeuge.ts'
import { freierName, formatGroesse } from '../telegram-gateway/objektWerkzeuge.ts'
import {
  akteText,
  type Bezug,
  type BriefingPerson,
  type BriefingTermin,
  briefingText,
  darfBezug,
  findeBezug,
  gespraechspunkte,
  kandidatenLader,
  type KiFunktion,
  ladeBriefingDaten,
  ladeLinkBasis,
  SAMMELAKTEN,
  TERMIN_SPALTEN,
} from '../_shared/terminBriefingKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const GESPRAECH_EIMER = 'gespraech-aufnahmen'
const AKTEN_EIMER = 'kunden-dokumente'
/** Mehr Audio wird nicht in die Akte kopiert (Speicherplatz; die Aufnahme bleibt bis zur Löschfrist in der App). */
export const HOECHSTENS_AUDIO_BYTES = 150 * 1024 * 1024
const HOECHSTENS_FOTOS = 40

export type GespraechKontext = {
  admin: Db
  aufrufer: Aufrufer
  /** Heute (Berlin) als JJJJ-MM-TT. */
  heute: string
  darfKunde: (kundeId: string) => Promise<boolean>
  darfBereich: (bereich: string) => Promise<boolean>
  darfObjekt?: (objektId: string) => Promise<boolean>
  /** Basis-Adresse des CRM (sonst aus willkommen_einstellung). */
  linkBasis?: string
  /** Nur Vorbereitung: KI für die Gesprächspunkte (Tests: ersetzen; null = ohne). */
  ki?: KiFunktion
  apiKey?: string | null
  jetzt?: Date
}

export type GespraechErgebnis = { status: number; daten: Record<string, unknown> }

type Analyse = {
  zusammenfassung?: string
  kernthemen?: string[]
  vereinbarungen?: string[]
  offene_punkte?: string[]
  naechste_schritte?: { text: string; faellig?: string; wer?: string }[]
  termine?: { titel: string; datum: string; uhrzeit?: string; ort?: string; mit?: string; dauer_min?: number }[]
  todos?: { text: string; faellig?: string; zustaendig?: string; zustaendig_email?: string }[]
  wiedervorlagen?: { titel: string; faellig: string }[]
  zahlen?: { was: string; betrag: number | string; einheit?: string }[]
  kundenfragen?: string[]
  einwaende?: string[]
  stimmung?: string
  risiken?: string[]
  stammdaten?: { feld: string; wert: string }[]
  unterlagen_fehlen?: string[]
  mail_entwurf?: { betreff?: string; text?: string }
  sprecher?: { label: string; name?: string; rolle?: string }[]
}

export type Uebernommen = {
  am: string
  von: string
  kundeId: string
  protokollId?: string
  naechsteSchritte?: boolean
  wiedervorlagen?: Record<string, string>
  todos?: Record<string, string>
  termine?: Record<string, string>
  stammdaten?: Record<string, string>
  audio?: { dokumentIds: string[]; uebersprungen?: string }
  fotos?: { dokumentIds: string[] }
  mailEntwurf?: boolean
  verlauf?: boolean
  objektVerlauf?: boolean
  hinweise?: string[]
}

type Aufnahme = {
  id: string
  mitarbeiter_email: string
  kunde_id: string | null
  kunde_bereich: string | null
  objekt_id: string | null
  termin_id: string | null
  titel: string | null
  art: string
  status: string
  segmente: { nr: number; pfad: string; mime?: string; dauer_s?: number; bytes?: number; text?: string }[] | null
  marker: { sek: number; text: string; art: string }[] | null
  notizen: string | null
  fotos: { pfad: string; name: string; sek: number }[] | null
  transkript: string | null
  analyse: Analyse | null
  uebernommen: Uebernommen | null
  dauer_s: number | null
  erstellt_am: string
}

const AUFNAHME_SPALTEN = 'id, mitarbeiter_email, kunde_id, kunde_bereich, objekt_id, termin_id, titel, art, status, segmente, marker, notizen, fotos, transkript, analyse, uebernommen, dauer_s, erstellt_am'

// ---------------------------------------------------------------------------------------------
// Kleine Helfer

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

/** Muster für ilike ohne Platzhalter (genauer Vergleich ohne Groß-/Kleinschreibung). */
function genau(s: string): string {
  return s.replace(/[\\%_]/g, (z) => `\\${z}`)
}

function text(x: unknown, n = 500): string {
  return String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
}

function liste(x: unknown, n = 30): string[] {
  return (Array.isArray(x) ? x : []).map((s) => text(s)).filter(Boolean).slice(0, n)
}

function istDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function deDatum(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

const BERLIN_TAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

function berlinTag(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ''))
  return Number.isNaN(d.getTime()) ? '' : BERLIN_TAG.format(d)
}

export function dauerText(sek: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sek) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')} Std.` : `${m}:${String(r).padStart(2, '0')} Min.`
}

function zeitmarke(sek: number): string {
  const s = Math.max(0, Math.round(Number(sek) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const ART_NAME: Record<string, string> = { termin: 'Kundentermin', telefon: 'Telefonat', notiz: 'Gesprächsnotiz' }
const MARKER_NAME: Record<string, string> = { wichtig: 'Wichtig', aufgabe: 'Aufgabe', frage: 'Frage' }

function akteName(a: { firma?: string | null; ansprechpartner?: string | null; id?: string }): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  if (f && p && f !== p) return `${p} (${f})`
  return p || f || String(a.id ?? '')
}

function fehler(status: number, meldung: string, zusatz: Record<string, unknown> = {}): GespraechErgebnis {
  return { status, daten: { error: meldung, ...zusatz } }
}

async function ladeAufnahme(k: GespraechKontext, id: unknown): Promise<Aufnahme | GespraechErgebnis> {
  const kennung = String(id ?? '').trim()
  if (!kennung) return fehler(400, 'id fehlt.')
  const { data, error } = await k.admin.from('gespraech_aufnahmen').select(AUFNAHME_SPALTEN).eq('id', kennung).maybeSingle()
  if (error) return fehler(500, `Die Aufnahme ließ sich nicht laden: ${error.message}`)
  // Fremde Aufnahmen gibt es für den Aufrufer nicht (gleiche Meldung wie „nicht vorhanden“).
  if (!data || adresse(data.mitarbeiter_email) !== adresse(k.aufrufer.email)) return fehler(404, 'Diese Aufnahme gibt es nicht (mehr).')
  return data as Aufnahme
}

function istErgebnis(x: unknown): x is GespraechErgebnis {
  return !!x && typeof x === 'object' && 'status' in x && 'daten' in x
}

// ---------------------------------------------------------------------------------------------
// Texte

/** Teilnehmer aus der Sprecher-Zuordnung, sonst Kunde und Mitarbeiter. */
export function teilnehmerText(analyse: Analyse | null, kunde: string, mitarbeiter: string): string {
  const namen = (analyse?.sprecher ?? []).map((s) => text(s?.name, 80)).filter(Boolean)
  const alle = [...new Set([...namen, mitarbeiter].filter(Boolean))]
  return namen.length ? alle.join(', ') : [kunde, mitarbeiter].filter(Boolean).join(', ')
}

/** Gegliederter Text des Protokolls; die Abschrift steht am Ende. */
export function protokollTextAus(a: Analyse, z: { teilnehmer: string; dauer: string; marker: Aufnahme['marker']; notizen: string | null; transkript: string; link: string }): string {
  const abschnitt = (titel: string, punkte: string[]) => (punkte.length ? `${titel}:\n${punkte.map((x) => `- ${x}`).join('\n')}` : '')
  const zahlen = (a.zahlen ?? []).map((x) => `${text(x?.was, 200)}: ${text(x?.betrag, 60)}${x?.einheit ? ` ${text(x.einheit, 30)}` : ''}`).filter((x) => !x.startsWith(':'))
  const schritte = (a.naechste_schritte ?? []).map((s) => schrittZeile(s)).filter(Boolean)
  const marker = (z.marker ?? []).map((m) => `${zeitmarke(m.sek)} ${MARKER_NAME[m.art] ?? 'Markierung'}${m.text ? `: ${text(m.text, 300)}` : ''}`)
  const teile = [
    `Teilnehmer: ${z.teilnehmer}`,
    `Dauer: ${z.dauer}`,
    a.zusammenfassung ? `Zusammenfassung:\n${String(a.zusammenfassung).trim().slice(0, 3000)}` : '',
    abschnitt('Besprochen', liste(a.kernthemen)),
    abschnitt('Vereinbart', liste(a.vereinbarungen)),
    abschnitt('Offene Punkte', liste(a.offene_punkte)),
    abschnitt('Nächste Schritte', schritte),
    abschnitt('Fragen des Kunden', liste(a.kundenfragen)),
    abschnitt('Einwände', liste(a.einwaende)),
    abschnitt('Zahlen', zahlen),
    abschnitt('Risiken', liste(a.risiken)),
    abschnitt('Fehlende Unterlagen', liste(a.unterlagen_fehlen)),
    a.stimmung ? `Stimmung: ${text(a.stimmung, 300)}` : '',
    abschnitt('Markierungen während des Gesprächs', marker),
    z.notizen?.trim() ? `Notizen:\n${z.notizen.trim().slice(0, 5000)}` : '',
    z.transkript ? `Abschrift:\n${z.transkript.slice(0, 200_000)}` : '',
    z.link ? `Aufnahme in der App: ${z.link}` : '',
  ]
  return teile.filter(Boolean).join('\n\n')
}

function schrittZeile(s: { text?: string; faellig?: string; wer?: string } | null | undefined): string {
  const t = text(s?.text)
  if (!t) return ''
  const zusatz = [text(s?.wer, 80), istDatum(s?.faellig) ? `bis ${deDatum(s!.faellig)}` : ''].filter(Boolean).join(', ')
  return zusatz ? `${t} (${zusatz})` : t
}

/** Anschrift einzeilig („Musterstr. 1, 89073 Ulm“) → wie in der Akte gespeichert (Zeilen). */
export function anschriftZeilen(wert: string): string {
  return String(wert ?? '')
    .split(/\n|;\s*/)
    .flatMap((z) => z.split(/,\s*(?=\d{5}\b)/))
    .map((z) => z.trim())
    .filter(Boolean)
    .join('\n')
}

/** Bearbeitete Fassung über die Auswertung legen (nur bekannte Felder, Listen in gleicher Reihenfolge). */
export function wirksameAnalyse(analyse: Analyse, bearbeitet: unknown): Analyse {
  const b = (bearbeitet && typeof bearbeitet === 'object' ? bearbeitet : {}) as Record<string, unknown>
  const aus: Analyse = { ...analyse }
  for (const feld of ['naechste_schritte', 'wiedervorlagen', 'todos', 'termine', 'stammdaten'] as const) {
    if (Array.isArray(b[feld])) (aus as Record<string, unknown>)[feld] = b[feld]
  }
  if (b.mail_entwurf && typeof b.mail_entwurf === 'object') aus.mail_entwurf = b.mail_entwurf as Analyse['mail_entwurf']
  if (typeof b.zusammenfassung === 'string' && b.zusammenfassung.trim()) aus.zusammenfassung = b.zusammenfassung
  return aus
}

function indizes(x: unknown, laenge: number): number[] {
  if (!Array.isArray(x)) return []
  return [...new Set(x.map((i) => Number(i)).filter((i) => Number.isInteger(i) && i >= 0 && i < laenge))]
}

function dateiEndung(mime: string | undefined, pfad: string): string {
  const ausPfad = pfad.match(/\.([a-z0-9]{2,5})$/i)?.[1]
  if (ausPfad) return ausPfad.toLowerCase()
  const m = String(mime ?? '').toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mpeg')) return 'mp3'
  if (m.includes('jpeg')) return 'jpg'
  if (m.includes('png')) return 'png'
  return 'bin'
}

function sicherName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/\s+/g, '_').slice(0, 120) || 'datei'
}

// ---------------------------------------------------------------------------------------------
// gespraech_uebernehmen

type Akte = {
  id: string
  bereich: string
  firma: string | null
  ansprechpartner: string | null
  verantwortlich: string | null
  verantwortlich_email: string | null
}

const STAMMDATEN_FELDER: StammdatenFeld[] = ['telefon', 'email', 'anschrift']
const FELD_NAME: Record<string, string> = { telefon: 'Telefon', email: 'E-Mail-Adresse', anschrift: 'Anschrift', firma: 'Firma', ansprechpartner: 'Ansprechpartner', sonstiges: 'Sonstiges' }

// deno-lint-ignore no-explicit-any
export async function gespraechUebernehmen(k: GespraechKontext, body: any): Promise<GespraechErgebnis> {
  const { admin, aufrufer, heute } = k
  const zeile = await ladeAufnahme(k, body?.id)
  if (istErgebnis(zeile)) return zeile
  if (zeile.status !== 'fertig' || !zeile.analyse) return fehler(409, 'Die Auswertung ist noch nicht fertig.')
  const kundeId = String(zeile.kunde_id ?? '').trim()
  if (!kundeId) return fehler(409, 'Bitte zuerst eine Akte zuordnen oder neu anlegen.')
  if (SAMMELAKTEN.includes(kundeId)) return fehler(409, 'In den Sammelakten werden keine Gesprächsprotokolle angelegt. Bitte die Akte des Kunden zuordnen.')
  const bisher: Uebernommen | null = zeile.uebernommen && typeof zeile.uebernommen === 'object' ? zeile.uebernommen : null
  if (bisher?.kundeId && bisher.kundeId !== kundeId) return fehler(409, 'Diese Aufnahme wurde schon in eine andere Akte übernommen.')
  if (!(await k.darfKunde(kundeId))) return fehler(403, 'Dieser Bereich ist für dich nicht freigegeben.')

  const { data: akteRoh, error: akteFehler } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (akteFehler) return fehler(500, `Die Akte ließ sich nicht laden: ${akteFehler.message}`)
  if (!akteRoh) return fehler(404, 'Die zugeordnete Akte gibt es nicht mehr. Bitte eine andere zuordnen.')
  const akte = akteRoh as Akte
  const privat = akte.bereich === 'privat'
  const name = akteName(akte)

  const auswahl = (body?.auswahl && typeof body.auswahl === 'object' ? body.auswahl : {}) as Record<string, unknown>
  const a = wirksameAnalyse(zeile.analyse, body?.bearbeitet)
  const u: Uebernommen = {
    ...(bisher ?? {}),
    am: bisher?.am ?? new Date().toISOString(),
    von: bisher?.von ?? aufrufer.name,
    kundeId,
    wiedervorlagen: { ...(bisher?.wiedervorlagen ?? {}) },
    todos: { ...(bisher?.todos ?? {}) },
    termine: { ...(bisher?.termine ?? {}) },
    stammdaten: { ...(bisher?.stammdaten ?? {}) },
  }
  const zeilen: string[] = []
  const hinweise: string[] = []
  const neuAngelegt: string[] = []
  const verlauf: { text: string }[] = []
  const datum = berlinTag(zeile.erstellt_am) || heute
  const artName = ART_NAME[zeile.art] ?? 'Gespräch'
  const betreff = text(zeile.titel, 200) || `${artName} am ${deDatum(datum)}`
  const linkBasis = k.linkBasis ?? (await ladeLinkBasis(admin))
  const appLink = `${linkBasis.endsWith('/') ? linkBasis : `${linkBasis}/`}gespraech/#/aufnahme/${encodeURIComponent(zeile.id)}`

  // 1. Protokoll (feste Kennung je Aufnahme: ein gleichzeitiger zweiter Aufruf scheitert am Schlüssel)
  if (!u.protokollId) {
    const protokollId = `p_gespr_${zeile.id.replace(/-/g, '').slice(0, 12)}`
    const teilnehmer = teilnehmerText(a, name, aufrufer.name)
    const transkript = String(zeile.transkript ?? '').trim()
    const { error } = await admin.from('protokolle').insert({
      id: protokollId,
      bereich: akte.bereich,
      kunde_id: kundeId,
      datum,
      teilnehmer: teilnehmer.slice(0, 300),
      betreff,
      text: protokollTextAus(a, { teilnehmer, dauer: dauerText(zeile.dauer_s), marker: zeile.marker, notizen: zeile.notizen, transkript, link: appLink }),
      kernthemen: liste(a.kernthemen).length ? liste(a.kernthemen) : null,
      vereinbarungen: liste(a.vereinbarungen).length ? liste(a.vereinbarungen) : null,
      offene_punkte: liste(a.offene_punkte).length ? liste(a.offene_punkte) : null,
      stimmung: text(a.stimmung, 300) || null,
      ki_zusammenfassung: String(a.zusammenfassung ?? '').trim().slice(0, 3000) || null,
      dauer_sekunden: Number.isFinite(Number(zeile.dauer_s)) && zeile.dauer_s !== null ? Math.round(Number(zeile.dauer_s)) : null,
    })
    if (error) {
      if (String(error.code) === '23505' || /duplicate key/i.test(error.message)) return fehler(409, 'Die Übernahme läuft gerade schon. Bitte kurz warten und die Seite neu laden.')
      return fehler(500, `Das Gesprächsprotokoll ließ sich nicht anlegen: ${error.message}. Nichts wurde übernommen.`)
    }
    u.protokollId = protokollId
    neuAngelegt.push('Gesprächsprotokoll')
    zeilen.push(`Gesprächsprotokoll „${betreff}“ in der Akte von ${name} angelegt.`)
  }

  // 2. Wiedervorlagen
  const wvListe = Array.isArray(a.wiedervorlagen) ? a.wiedervorlagen : []
  for (const i of indizes(auswahl.wiedervorlagen, wvListe.length)) {
    if (u.wiedervorlagen![String(i)]) continue
    const wv = wvListe[i]
    const titel = text(wv?.titel, 300)
    if (privat) {
      hinweise.push(`Wiedervorlage „${titel}“ nicht angelegt: Private Kontakte haben keine Wiedervorlagen (dafür ein To-do nehmen).`)
      continue
    }
    if (!titel || !istDatum(wv?.faellig)) {
      hinweise.push(`Wiedervorlage ${i + 1} nicht angelegt: Titel oder Datum fehlt.`)
      continue
    }
    const { data, error } = await admin.from('wiedervorlagen').insert({
      kunde_id: kundeId,
      bereich: akte.bereich,
      titel,
      faellig: wv.faellig,
      notiz: `Aus der Gesprächsaufnahme vom ${deDatum(datum)}`,
      verantwortlich: String(akte.verantwortlich ?? '').trim() || null,
      quelle: 'hand',
      erstellt_von: aufrufer.name,
    }).select('id').single()
    if (error || !data) {
      hinweise.push(`Wiedervorlage „${titel}“ nicht angelegt: ${error?.message ?? 'unbekannter Fehler'}.`)
      continue
    }
    u.wiedervorlagen![String(i)] = String(data.id)
    neuAngelegt.push(`Wiedervorlage „${titel}“ zum ${deDatum(wv.faellig)}`)
  }

  // 3. To-dos (wie todo_anlegen des Assistenten: eigene Liste oder die eines Kollegen)
  const todoListe = Array.isArray(a.todos) ? a.todos : []
  const todoIdx = indizes(auswahl.todos, todoListe.length).filter((i) => !u.todos![String(i)])
  if (todoIdx.length > 0) {
    const { data: ich } = await admin.from('mitarbeiter').select('id, name, email, rolle, ist_admin, bereiche').ilike('email', genau(adresse(aufrufer.email))).maybeSingle()
    const { data: teamRoh } = await admin.from('mitarbeiter').select('name, email').eq('aktiv', true)
    const team = ((teamRoh ?? []) as { name: string; email: string }[]).map((m) => ({ name: String(m.name ?? ''), email: adresse(m.email) }))
    const fragender = { id: String(ich?.id ?? ''), name: aufrufer.name, email: aufrufer.email, rolle: ich?.rolle ?? null, ist_admin: ich?.ist_admin ?? null, bereiche: ich?.bereiche ?? null }
    for (const i of todoIdx) {
      const t = todoListe[i]
      const aufgabe = text(t?.text, 400)
      if (!aufgabe) continue
      const zustEmail = adresse(t?.zustaendig_email)
      const kollege = zustEmail && zustEmail !== adresse(aufrufer.email) ? team.find((m) => m.email === zustEmail) : undefined
      if (zustEmail && zustEmail !== adresse(aufrufer.email) && !kollege) {
        hinweise.push(`To-do „${aufgabe}“ nicht angelegt: ${zustEmail} ist kein aktiver Mitarbeiter.`)
        continue
      }
      const freierZustaendiger = !zustEmail ? text(t?.zustaendig, 80) : ''
      const ergebnis = await todoAnlegen(admin, fragender, {
        aufgabe,
        erledigen_bis: istDatum(t?.faellig) ? t.faellig : undefined,
        kunde_projekt: name,
        ...(kollege ? { fuer: kollege.name } : freierZustaendiger ? { zustaendig: freierZustaendiger } : {}),
      }, () => {})
      const tid = ergebnis.match(/todo_id=(\S+)/)?.[1]
      if (!tid || /^(Fehler|Nicht angelegt)/.test(ergebnis)) {
        hinweise.push(`To-do „${aufgabe}“ nicht angelegt: ${ergebnis.replace(/^Fehler:\s*/, '')}`)
        continue
      }
      u.todos![String(i)] = tid
      neuAngelegt.push(`To-do „${aufgabe}“${kollege ? ` für ${kollege.name}` : ''}`)
    }
  }

  // 4. Termine im Kalender des Besitzers (keine Einladung an den Kunden, keine Teilnehmer)
  const terminListe = Array.isArray(a.termine) ? a.termine : []
  for (const i of indizes(auswahl.termine, terminListe.length)) {
    if (u.termine![String(i)]) continue
    const t = terminListe[i]
    const titel = text(t?.titel, 200)
    if (!titel || !istDatum(t?.datum)) {
      hinweise.push(`Termin ${i + 1} nicht angelegt: Titel oder Datum fehlt.`)
      continue
    }
    const uhr = /^\d{1,2}:\d{2}$/.test(String(t?.uhrzeit ?? '').trim()) ? String(t.uhrzeit).trim() : ''
    const dauer = Math.min(Math.max(Math.round(Number(t?.dauer_min) || 60), 15), 600)
    const beginn = berlinZeitZuUtc(`${t.datum}T${uhr || '00:00'}`)
    if (!beginn) {
      hinweise.push(`Termin „${titel}“ nicht angelegt: Uhrzeit nicht erkannt.`)
      continue
    }
    const ende = uhr ? new Date(Date.parse(beginn) + dauer * 60000).toISOString() : berlinZeitZuUtc(naechsterTag(t.datum) + 'T00:00')!
    const eingabe: TerminEingabe = {
      titel,
      ort: text(t?.ort, 200),
      beschreibung: [t?.mit ? `Mit: ${text(t.mit, 200)}` : '', `Aus der Gesprächsaufnahme vom ${deDatum(datum)}.`].filter(Boolean).join('\n'),
      beginn,
      ende,
      ganztags: !uhr,
      teilnehmer: [],
      kunde: { id: kundeId, bereich: akte.bereich, name },
      quelle: 'gespraech',
      gast_einladen: false,
    }
    let r = await speichereTermin(admin, aufrufer, eingabe)
    if (!r.ok && r.status === 409) {
      r = await speichereTermin(admin, aufrufer, { ...eingabe, trotzUeberschneidung: true })
      if (r.ok) hinweise.push(`Termin „${titel}“ überschneidet sich mit einem anderen Termin — trotzdem eingetragen.`)
    }
    if (!r.ok) {
      hinweise.push(`Termin „${titel}“ nicht angelegt: ${r.fehler}`)
      continue
    }
    u.termine![String(i)] = String(r.termin.id)
    neuAngelegt.push(`Termin „${titel}“ am ${deDatum(t.datum)}${uhr ? ` um ${uhr} Uhr` : ''}`)
  }

  // 5. Audio und Fotos: erst hochladen, dann zusammen mit den übrigen Feldern in die Akte schreiben.
  const neueDokumente: { id: string; name: string; typ: string; datum: string; groesse: string; url: string; quelle: string }[] = []
  const hochgeladen: string[] = []
  const ablegen = async (pfad: string, anzeige: string, mime: string): Promise<string | null> => {
    const { data: blob, error: ladeFehler } = await admin.storage.from(GESPRAECH_EIMER).download(pfad)
    if (ladeFehler || !blob) return `„${anzeige}“ ließ sich nicht laden: ${ladeFehler?.message ?? 'nicht gefunden'}`
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const kennung = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const ziel = `${kundeId}/${kennung}_${sicherName(anzeige)}`
    const { error: hochFehler } = await admin.storage.from(AKTEN_EIMER).upload(ziel, bytes, { contentType: mime || 'application/octet-stream', upsert: false })
    if (hochFehler) return `„${anzeige}“ ließ sich nicht ablegen: ${hochFehler.message}`
    hochgeladen.push(ziel)
    neueDokumente.push({ id: kennung, name: anzeige, typ: mime || 'application/octet-stream', datum: heute, groesse: formatGroesse(bytes.length), url: ziel, quelle: 'gespraech' })
    return null
  }
  // Nur Pfade dieser Aufnahme des Besitzers: segmente/fotos schreibt auch der Browser.
  const eigenerPfad = (p: unknown) => typeof p === 'string' && istSichererPfad(p) && p.startsWith(`${adresse(zeile.mitarbeiter_email)}/${zeile.id}/`)
  let audioIds: string[] | null = null
  if (auswahl.audioInAkte === true && !u.audio) {
    const teile = (Array.isArray(zeile.segmente) ? zeile.segmente : []).filter((s) => eigenerPfad(s?.pfad)).sort((x, y) => Number(x.nr) - Number(y.nr))
    const summe = teile.reduce((n, s) => n + (Number(s.bytes) || 0), 0)
    if (teile.length === 0) hinweise.push('Audio nicht abgelegt: Es gibt keine Audiodateien (mehr) zu dieser Aufnahme.')
    else if (summe > HOECHSTENS_AUDIO_BYTES) {
      u.audio = { dokumentIds: [], uebersprungen: `zu groß (${formatGroesse(summe)})` }
      hinweise.push(`Audio nicht in die Akte kopiert: Die Aufnahme ist mit ${formatGroesse(summe)} zu groß (höchstens ${formatGroesse(HOECHSTENS_AUDIO_BYTES)}). Sie bleibt bis zur Löschfrist in der App.`)
    } else {
      const vorher = neueDokumente.length
      let fehlgeschlagen = false
      for (const [n, s] of teile.entries()) {
        const anzeige = `Gesprächsaufnahme ${deDatum(datum)}${teile.length > 1 ? ` Teil ${n + 1} von ${teile.length}` : ''}.${dateiEndung(s.mime, s.pfad)}`
        const f = await ablegen(s.pfad, anzeige, String(s.mime ?? ''))
        if (f) {
          hinweise.push(`Audio nicht vollständig abgelegt: ${f}.`)
          fehlgeschlagen = true
          break
        }
      }
      if (fehlgeschlagen) {
        // Halb abgelegt hilft niemandem: die schon kopierten Teile wieder entfernen.
        const weg = neueDokumente.splice(vorher).map((d) => d.url)
        if (weg.length) await admin.storage.from(AKTEN_EIMER).remove(weg).catch(() => {})
        for (const p of weg) hochgeladen.splice(hochgeladen.indexOf(p), 1)
      } else audioIds = neueDokumente.slice(vorher).map((d) => d.id)
    }
  }
  let fotoIds: string[] | null = null
  if (auswahl.fotosInAkte === true && !u.fotos) {
    const fotos = (Array.isArray(zeile.fotos) ? zeile.fotos : []).filter((f) => eigenerPfad(f?.pfad)).slice(0, HOECHSTENS_FOTOS)
    const vorher = neueDokumente.length
    for (const [n, f] of fotos.entries()) {
      const anzeige = `Foto aus dem Gespräch ${deDatum(datum)} (${n + 1}).${dateiEndung(undefined, f.pfad)}`
      const fehlerText = await ablegen(f.pfad, anzeige, dateiEndung(undefined, f.pfad) === 'png' ? 'image/png' : 'image/jpeg')
      if (fehlerText) hinweise.push(`Foto nicht abgelegt: ${fehlerText}.`)
    }
    if (fotos.length) fotoIds = neueDokumente.slice(vorher).map((d) => d.id)
  }

  // 6. Akte: frisch lesen, nur geänderte Felder schreiben.
  const { data: frisch, error: frischFehler } = await admin.from('kunden').select('activities, naechste_schritte, telefon, email, anschrift, stammdaten_vorschlaege, dokumente').eq('id', kundeId).maybeSingle()
  const aenderung: Record<string, unknown> = {}
  let akteGeschrieben = false
  if (frischFehler || !frisch) {
    hinweise.push(`Die Akte selbst ließ sich nicht aktualisieren: ${frischFehler?.message ?? 'nicht gefunden'}.`)
  } else {
    // Nächste Schritte
    const schritte = (Array.isArray(a.naechste_schritte) ? a.naechste_schritte : []).map((s) => schrittZeile(s)).filter(Boolean)
    if (auswahl.naechsteSchritte === true && !u.naechsteSchritte && schritte.length > 0) {
      const alt = String(frisch.naechste_schritte ?? '').trim()
      aenderung.naechste_schritte = schritte.map((x) => `- ${x}`).join('\n')
      verlauf.push({ text: `Nächste Schritte aus der Gesprächsaufnahme übernommen.${alt ? ` Vorher stand dort: „${alt.slice(0, 600)}“` : ''}` })
    }
    // Stammdaten
    const sdListe = Array.isArray(a.stammdaten) ? a.stammdaten : []
    let vorschlaege: StammdatenVorschlag[] = alsVorschlaege(frisch.stammdaten_vorschlaege)
    let vorschlaegeGeaendert = false
    const sdErledigt: Record<string, string> = {}
    const sonstige: string[] = []
    for (const i of indizes(auswahl.stammdaten, sdListe.length)) {
      if (u.stammdaten![String(i)]) continue
      const feld = String(sdListe[i]?.feld ?? '')
      const roh = String(sdListe[i]?.wert ?? '').trim().slice(0, 300)
      if (!roh) continue
      if (!(STAMMDATEN_FELDER as string[]).includes(feld)) {
        sonstige.push(`${FELD_NAME[feld] ?? 'Angabe'}: ${roh.replace(/\s+/g, ' ')}`)
        sdErledigt[String(i)] = 'notiz'
        continue
      }
      const f = feld as StammdatenFeld
      const wert = f === 'anschrift' ? anschriftZeilen(roh) : f === 'email' ? roh.toLowerCase() : roh
      const jetzt = String((aenderung[f] as string | undefined) ?? frisch[f] ?? '').trim()
      if (!jetzt) {
        aenderung[f] = wert
        verlauf.push({ text: `${FELD_NAME[f]} aus der Gesprächsaufnahme vom ${deDatum(datum)} ergänzt: ${wert.replace(/\n/g, ', ')}` })
        sdErledigt[String(i)] = 'ergaenzt'
      } else if (gleicherWert(f, jetzt, wert)) {
        sdErledigt[String(i)] = 'gleich'
      } else {
        const v: StammdatenVorschlag & { quelle: string } = {
          id: `sv_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          feld: f,
          wert,
          bisher: jetzt,
          mailDatum: datum,
          mailId: null,
          erstellt: heute,
          status: 'offen',
          quelle: 'gespraech',
        }
        const neu = haengeAn(vorschlaege, [v])
        if (neu.includes(v)) {
          vorschlaege = neu
          vorschlaegeGeaendert = true
          sdErledigt[String(i)] = v.id
        } else sdErledigt[String(i)] = 'schon_vorgeschlagen'
      }
    }
    if (vorschlaegeGeaendert) aenderung.stammdaten_vorschlaege = vorschlaege
    if (sonstige.length) verlauf.push({ text: `Im Gespräch genannt (nicht in die Stammdaten übernommen): ${sonstige.join('; ')}` })
    // Mail-Entwurf: nur als Notiz, verschickt wird nichts.
    const betreffMail = text(a.mail_entwurf?.betreff, 200)
    const textMail = String(a.mail_entwurf?.text ?? '').trim().slice(0, 6000)
    const mailUebernehmen = auswahl.mailEntwurf === true && !u.mailEntwurf && (betreffMail || textMail)
    if (mailUebernehmen) verlauf.push({ text: `Mail-Entwurf aus dem Gespräch (nicht verschickt) — Betreff: ${betreffMail || '(ohne)'}\n\n${textMail}` })
    if (neueDokumente.length) {
      verlauf.push({ text: `${neueDokumente.length === 1 ? 'Datei' : `${neueDokumente.length} Dateien`} aus der Gesprächsaufnahme unter Dokumente abgelegt: ${neueDokumente.map((d) => d.name).join(', ')}` })
      const vorhandene = Array.isArray(frisch.dokumente) ? frisch.dokumente : []
      const belegt = [...vorhandene]
      for (const d of neueDokumente) {
        d.name = freierName(d.name, belegt)
        belegt.push(d)
      }
      aenderung.dokumente = [...neueDokumente, ...vorhandene]
    }
    // Haupteintrag (zuletzt angehängt = steht oben)
    const angelegtText = neuAngelegt.length ? `: ${neuAngelegt.join(', ')}` : ''
    if (!u.verlauf) verlauf.push({ text: `Gesprächsaufnahme übernommen (${artName}, ${dauerText(zeile.dauer_s)}): „${betreff}“${angelegtText}.` })
    else if (neuAngelegt.length) verlauf.push({ text: `Weitere Punkte aus der Gesprächsaufnahme „${betreff}“ übernommen${angelegtText}.` })
    if (verlauf.length) {
      // Neueste zuerst; der Haupteintrag steht oben.
      const eintraege = [...verlauf].reverse().map((v) => ({ id: crypto.randomUUID(), date: heute, text: v.text, user: aufrufer.name }))
      aenderung.activities = [...eintraege, ...(Array.isArray(frisch.activities) ? frisch.activities : [])]
      aenderung.letzte_aktivitaet = heute
    }
    if (Object.keys(aenderung).length) {
      const { error } = await admin.from('kunden').update(aenderung).eq('id', kundeId)
      if (error) hinweise.push(`Die Akte selbst (Verlauf, Nächste Schritte, Stammdaten, Dokumente) ließ sich nicht aktualisieren: ${error.message}.`)
      else akteGeschrieben = true
    } else akteGeschrieben = true
    if (akteGeschrieben) {
      if (verlauf.length) u.verlauf = true
      if ('naechste_schritte' in aenderung) {
        u.naechsteSchritte = true
        zeilen.push('„Nächste Schritte“ der Akte ersetzt (der alte Text steht im Verlauf).')
      }
      Object.assign(u.stammdaten!, sdErledigt)
      const erg = Object.values(sdErledigt).filter((x) => x === 'ergaenzt').length
      const vor = Object.values(sdErledigt).filter((x) => x.startsWith('sv_')).length
      if (erg) zeilen.push(`${erg} leere${erg === 1 ? 's' : ''} Stammdatenfeld${erg === 1 ? '' : 'er'} ergänzt.`)
      if (vor) zeilen.push(`${vor} Stammdaten-Vorschl${vor === 1 ? 'ag' : 'äge'} in der Akte (nichts überschrieben).`)
      if (mailUebernehmen) {
        u.mailEntwurf = true
        zeilen.push('Mail-Entwurf als Notiz im Verlauf der Akte (nicht verschickt).')
      }
      if (audioIds) {
        u.audio = { dokumentIds: audioIds }
        zeilen.push(`Audio in der Akte abgelegt (${audioIds.length} Datei${audioIds.length === 1 ? '' : 'en'}).`)
      }
      if (fotoIds) {
        u.fotos = { dokumentIds: fotoIds }
        if (fotoIds.length) zeilen.push(`${fotoIds.length} Foto${fotoIds.length === 1 ? '' : 's'} in der Akte abgelegt.`)
      }
    }
  }
  if (!akteGeschrieben && hochgeladen.length) await admin.storage.from(AKTEN_EIMER).remove(hochgeladen).catch(() => {})

  // 7. Objekt: kurzer Verlaufseintrag, falls die Aufnahme auch an einem Objekt hängt.
  if (zeile.objekt_id && !u.objektVerlauf && (!k.darfObjekt || (await k.darfObjekt(zeile.objekt_id)))) {
    const { data: obj } = await admin.from('objekte').select('activities').eq('id', zeile.objekt_id).maybeSingle()
    if (obj) {
      const eintrag = { id: crypto.randomUUID(), date: heute, text: `Gesprächsaufnahme „${betreff}“ (${artName}) — Protokoll in der Akte von ${name}.`, user: aufrufer.name }
      const { error } = await admin.from('objekte').update({ activities: [eintrag, ...(Array.isArray(obj.activities) ? obj.activities : [])] }).eq('id', zeile.objekt_id)
      if (!error) u.objektVerlauf = true
    }
  }

  const zaehle = (r?: Record<string, string>) => Object.keys(r ?? {}).length
  const neu = (feld: 'wiedervorlagen' | 'todos' | 'termine') => zaehle(u[feld]) - zaehle(bisher?.[feld])
  if (neu('wiedervorlagen') > 0) zeilen.push(`${neu('wiedervorlagen')} Wiedervorlage${neu('wiedervorlagen') === 1 ? '' : 'n'} angelegt.`)
  if (neu('todos') > 0) zeilen.push(`${neu('todos')} To-do${neu('todos') === 1 ? '' : 's'} angelegt.`)
  if (neu('termine') > 0) zeilen.push(`${neu('termine')} Termin${neu('termine') === 1 ? '' : 'e'} im Kalender eingetragen.`)
  if (zeilen.length === 0 && hinweise.length === 0) zeilen.push('Schon alles übernommen — nichts neu angelegt.')
  u.hinweise = hinweise.length ? hinweise.slice(0, 20) : bisher?.hinweise
  const { error: speicherFehler } = await admin.from('gespraech_aufnahmen').update({ uebernommen: u, geaendert_am: new Date().toISOString() }).eq('id', zeile.id)
  if (speicherFehler) hinweise.push(`Vermerk an der Aufnahme ließ sich nicht speichern (ein zweites Übernehmen könnte doppelt anlegen): ${speicherFehler.message}`)
  return { status: 200, daten: { ok: true, zeilen, hinweise, uebernommen: u } }
}

function naechsterTag(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------------------------
// gespraech_akte_setzen

const NEUANLAGE_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
// Wie START_STATUS in telegram-gateway/index.ts (kunde_anlegen).
const START_STATUS: Record<string, string> = {
  beratung: 'lead', erben: 'erstkontakt', betriebsuebergabe: 'erstkontakt', betriebsformen: 'erstkontakt',
  akademie: 'interessent', finanzierungen: 'interessent', immobilienkunden: 'interessent', privat: 'neu',
}

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// deno-lint-ignore no-explicit-any
export async function gespraechAkteSetzen(k: GespraechKontext, body: any): Promise<GespraechErgebnis> {
  const { admin, aufrufer, heute } = k
  const zeile = await ladeAufnahme(k, body?.id)
  if (istErgebnis(zeile)) return zeile
  if (zeile.status === 'verworfen') return fehler(409, 'Diese Aufnahme ist verworfen.')
  if (zeile.uebernommen?.protokollId) return fehler(409, 'Diese Aufnahme ist schon in eine Akte übernommen — die Akte lässt sich nicht mehr ändern.')

  let kundeId = String(body?.kundeId ?? '').trim()
  let bereich = ''
  let angelegt = false
  if (kundeId) {
    if (SAMMELAKTEN.includes(kundeId)) return fehler(400, 'Sammelakten lassen sich nicht zuordnen. Bitte die Akte des Kunden wählen.')
    const { data: akte } = await admin.from('kunden').select('id, bereich').eq('id', kundeId).maybeSingle()
    if (!akte) return fehler(404, 'Diese Akte gibt es nicht.')
    if (!(await k.darfKunde(kundeId))) return fehler(403, 'Dieser Bereich ist für dich nicht freigegeben.')
    bereich = String(akte.bereich ?? '')
  } else {
    const neu = (body?.neu && typeof body.neu === 'object' ? body.neu : null) as Record<string, unknown> | null
    if (!neu) return fehler(400, 'kundeId oder neu fehlt.')
    bereich = String(neu.bereich ?? '').trim()
    const firma = text(neu.firma, 200)
    const ansprechpartner = text(neu.ansprechpartner, 200)
    const email = text(neu.email, 200).toLowerCase()
    const telefon = text(neu.telefon, 80)
    const privat = bereich === 'privat'
    if (!NEUANLAGE_BEREICHE.includes(bereich) && !privat) return fehler(400, 'Bitte einen gültigen Bereich wählen.')
    if (!firma) return fehler(400, 'Bitte einen Namen oder eine Firma angeben.')
    if (!privat && !(await k.darfBereich(bereich))) return fehler(403, 'In diesem Bereich darfst du keine Akte anlegen.')
    // Dubletten: gleicher Name oder gleiche E-Mail-Adresse (fremde private Kontakte zählen nicht).
    const treffer: { id: string; bereich: string; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }[] = []
    for (const [spalte, wert] of [['firma', firma], ['ansprechpartner', firma], ...(email ? [['email', email]] : [])] as [string, string][]) {
      const { data } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').ilike(spalte, genau(wert)).limit(5)
      for (const t of (data ?? []) as typeof treffer) if (!treffer.some((x) => x.id === t.id)) treffer.push(t)
    }
    const sichtbar = treffer.filter((t) => t.bereich !== 'privat' || adresse(t.verantwortlich_email) === adresse(aufrufer.email))
    const doppelt = sichtbar.find((t) => norm(t.firma) === norm(firma) || norm(t.ansprechpartner) === norm(firma)) ?? sichtbar[0]
    if (doppelt && body?.trotzDoppelt !== true) {
      if (!(await k.darfKunde(doppelt.id))) return fehler(409, 'Eine Akte mit diesem Namen oder dieser E-Mail-Adresse gibt es schon, in einem Bereich, der für dich nicht freigegeben ist. Bitte die Geschäftsführung fragen.')
      return fehler(409, `Es gibt schon eine Akte „${akteName(doppelt)}“. Diese nehmen oder trotzdem neu anlegen?`, { doppelt: { id: doppelt.id, name: akteName(doppelt), bereich: doppelt.bereich } })
    }
    kundeId = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const { error } = await admin.from('kunden').insert({
      id: kundeId,
      bereich,
      firma,
      ansprechpartner: ansprechpartner || firma,
      email,
      telefon,
      prioritaet: 'Mittel',
      status: START_STATUS[bereich] ?? 'neu',
      follow_up: { date: heute, note: 'Erstkontakt aus Gesprächsaufnahme nachbereiten', done: false },
      verantwortlich: aufrufer.name,
      ...(privat ? { verantwortlich_email: adresse(aufrufer.email) } : {}),
      letzte_aktivitaet: heute,
      activities: [{ id: crypto.randomUUID(), date: heute, text: `Akte aus einer Gesprächsaufnahme von ${aufrufer.name} angelegt.`, user: aufrufer.name }],
      dokumente: [],
    })
    if (error) return fehler(500, `Die Akte ließ sich nicht anlegen: ${error.message}`)
    angelegt = true
  }
  const { error } = await admin.from('gespraech_aufnahmen').update({ kunde_id: kundeId, kunde_bereich: bereich, geaendert_am: new Date().toISOString() }).eq('id', zeile.id)
  if (error) return fehler(500, `Die Zuordnung ließ sich nicht speichern: ${error.message}${angelegt ? ` (die Akte ${kundeId} ist schon angelegt)` : ''}`)
  return { status: 200, daten: { ok: true, kundeId, kundeBereich: bereich, angelegt } }
}

// ---------------------------------------------------------------------------------------------
// gespraech_vorbereitung

// deno-lint-ignore no-explicit-any
export async function gespraechVorbereitung(k: GespraechKontext, body: any): Promise<GespraechErgebnis> {
  const { admin, aufrufer, heute } = k
  const ich = adresse(aufrufer.email)
  const jetzt = k.jetzt ?? new Date()
  const { data: m } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche').ilike('email', genau(ich)).maybeSingle()
  if (!m) return fehler(403, 'Kein aktiver Mitarbeiter.')
  const person: BriefingPerson = { email: ich, name: m.name, rolle: m.rolle, ist_admin: m.ist_admin, bereiche: m.bereiche }
  const { data: teamZeilen } = await admin.from('mitarbeiter').select('name, email').eq('aktiv', true)
  const teamListe = ((teamZeilen ?? []) as { name: string; email: string }[]).map((x) => ({ name: String(x.name ?? ''), email: adresse(x.email) }))
  const namen = new Map(teamListe.map((x) => [x.email, x.name]))

  const terminId = String(body?.terminId ?? '').trim()
  const kundeId = String(body?.kundeId ?? '').trim()
  const objektId = String(body?.objektId ?? '').trim()
  let termin: BriefingTermin | null = null
  let bezug: Bezug | null = null
  if (terminId) {
    const { data: t } = await admin.from('termine').select(TERMIN_SPALTEN).eq('id', terminId).maybeSingle()
    const beteiligt = t && (adresse(t.besitzer_email) === ich || ((t.teilnehmer ?? []) as string[]).map(adresse).includes(ich))
    if (!t || !beteiligt) return fehler(404, 'Diesen Termin gibt es nicht (mehr).')
    termin = t as BriefingTermin
    bezug = await findeBezug(admin, termin, { team: new Set(teamListe.map((x) => x.email)), teamNamen: teamListe.map((x) => x.name), lader: kandidatenLader(admin) })
    if (!bezug) return { status: 200, daten: { ok: true, termin, bezug: null, hinweis: 'Der Termin ist mit keiner Akte verknüpft, und aus Titel oder Gast ergibt sich keine eindeutige Akte. Bitte die Akte suchen.' } }
  } else if (kundeId) {
    const { data: akte } = await admin.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (!akte) return fehler(404, 'Diese Akte gibt es nicht.')
    bezug = { art: 'kunde', id: String(akte.id), bereich: String(akte.bereich ?? ''), verantwortlichEmail: akte.verantwortlich_email ?? null, wie: 'verknuepft' }
  } else if (objektId) {
    const { data: o } = await admin.from('objekte').select('id, privat_besitzer').eq('id', objektId).maybeSingle()
    if (!o) return fehler(404, 'Dieses Objekt gibt es nicht.')
    bezug = { art: 'objekt', id: String(o.id), privatBesitzer: o.privat_besitzer ?? null, wie: 'besichtigung' }
  } else return fehler(400, 'terminId, kundeId oder objektId fehlt.')

  if (bezug.art === 'kunde' && SAMMELAKTEN.includes(bezug.id)) return fehler(400, 'Für die Sammelakten gibt es keine Vorbereitung.')
  if (!darfBezug(person, bezug)) return fehler(403, 'Diese Akte ist für dich nicht freigegeben.')

  // Ohne Termin: der nächste eigene Termin zu dieser Akte in den nächsten 60 Tagen (für Kopf und Vorgabe).
  if (!termin && bezug.art === 'kunde') {
    const { data } = await admin.from('termine').select(TERMIN_SPALTEN).eq('kunde_id', bezug.id).gte('beginn', new Date(jetzt.getTime() - 15 * 60000).toISOString()).lte('beginn', new Date(jetzt.getTime() + 60 * 86400000).toISOString()).order('beginn', { ascending: true }).limit(20)
    termin = ((data ?? []) as BriefingTermin[]).find((t) => adresse(t.besitzer_email) === ich || (t.teilnehmer ?? []).map(adresse).includes(ich)) ?? null
  }

  const linkBasis = k.linkBasis ?? (await ladeLinkBasis(admin))
  let daten
  try {
    daten = await ladeBriefingDaten(admin, bezug, heute, { linkBasis })
  } catch (err) {
    return fehler(500, err instanceof Error ? err.message : String(err))
  }
  if (!daten) return fehler(404, 'Die Akte bzw. das Objekt ließ sich nicht laden.')
  const punkte = body?.punkte === false ? [] : await gespraechspunkte(akteText(daten), { funktion: 'email-gateway', ki: k.ki, apiKey: k.apiKey })
  const minutenBis = termin ? (new Date(termin.beginn).getTime() - jetzt.getTime()) / 60000 : undefined
  const vorgabe = {
    terminId: termin?.id ?? null,
    kundeId: bezug.art === 'kunde' ? bezug.id : null,
    kundeBereich: bezug.art === 'kunde' ? bezug.bereich : null,
    objektId: bezug.art === 'objekt' ? bezug.id : null,
    titel: termin?.titel ?? daten.kopf,
  }
  return {
    status: 200,
    daten: { ok: true, termin, bezug, briefing: daten, gespraechspunkte: punkte, text: briefingText(daten, { termin, minutenBis, namen, gespraechspunkte: punkte }), vorgabe },
  }
}
