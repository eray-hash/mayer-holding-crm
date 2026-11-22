// Assistent-Werkzeuge für die Abteilung „Bücher & Verlag“ (Tabellen buecher und buch_kontakte,
// 21.11.2026; Oberfläche: src/pages/buecher/*, Datenformen in src/lib/buecher.ts).
//
// Ein Buch durchläuft Stufen (idee → … → vertrieb, daneben „ruht“) und trägt eine Checkliste
// (buecher.checkliste = { schrittId: true }) mit den üblichen Schritten im deutschen Buchmarkt.
// Dateien liegen im Speicher "kunden-dokumente" unter buecher/<buch-id>/… und stehen in
// buecher.dokumente. Kontakte (Autoren, Druckereien …) stehen in buch_kontakte, verknüpft über buch_ids.
// Einen Verlauf hat ein Buch im CRM nicht — dort zählt nur „zuletzt geändert am/von“
// (geaendert_am, geaendert_von); genau das schreibt auch der Assistent.
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregel der
// Datenbank nach: aktive Mitarbeiter und zusätzlich darf_bereich('buecher') → darfBereich(m, 'buecher').
// Löschen gibt es hier bewusst nicht, Dateien hochladen auch nicht (das geht im CRM).

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { darfBereich, type RechteMitarbeiter } from './rechte.ts'
import { deDatum, pruefeDatum } from './wiedervorlageWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type BuecherKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

// ---------------------------------------------------------------------------------------------
// Stufen und Checkliste — genau wie src/data/statusNetworks.ts (BUECHER_STUFEN) und
// src/lib/buecher.ts (BUCH_CHECKLISTE). Ändert sich dort etwas, hier nachziehen.

export const BUCH_STUFEN: { id: string; label: string }[] = [
  { id: 'idee', label: 'Idee' },
  { id: 'manuskript', label: 'Manuskript' },
  { id: 'lektorat', label: 'Lektorat' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'satz', label: 'Satz & Gestaltung' },
  { id: 'druckfreigabe', label: 'Druckfreigabe' },
  { id: 'druck', label: 'Im Druck' },
  { id: 'veroeffentlicht', label: 'Veröffentlicht' },
  { id: 'vertrieb', label: 'Im Vertrieb' },
  { id: 'ruht', label: 'Ruht' },
]

export const BUCH_CHECKLISTE: { stufe: string; titel: string; schritte: { id: string; label: string }[] }[] = [
  {
    stufe: 'idee',
    titel: 'Idee & Planung',
    schritte: [
      { id: 'konzept', label: 'Idee und Zielgruppe festgehalten' },
      { id: 'kalkulation', label: 'Grobe Kalkulation (Auflage, Druckkosten, Ladenpreis)' },
      { id: 'vertrag_autor', label: 'Vertrag mit Autor geschlossen' },
    ],
  },
  { stufe: 'manuskript', titel: 'Manuskript', schritte: [{ id: 'manuskript_fertig', label: 'Manuskript fertig' }] },
  {
    stufe: 'lektorat',
    titel: 'Lektorat & Korrektorat',
    schritte: [
      { id: 'lektorat_beauftragt', label: 'Lektorat beauftragt' },
      { id: 'lektorat_abgeschlossen', label: 'Lektorat abgeschlossen' },
      { id: 'korrektorat', label: 'Korrektorat (Rechtschreibung) abgeschlossen' },
    ],
  },
  {
    stufe: 'illustration',
    titel: 'Illustration',
    schritte: [
      { id: 'illustration_beauftragt', label: 'Illustrationen beauftragt' },
      { id: 'illustration_abgenommen', label: 'Illustrationen abgenommen' },
    ],
  },
  {
    stufe: 'satz',
    titel: 'Satz, Gestaltung & Nummern',
    schritte: [
      { id: 'satz_layout', label: 'Satz und Gestaltung der Innenseiten' },
      { id: 'cover', label: 'Umschlag (Cover) fertig' },
      { id: 'isbn', label: 'ISBN beantragt' },
      { id: 'vlb', label: 'Eintrag im Verzeichnis lieferbarer Bücher (VLB)' },
      { id: 'impressum', label: 'Impressum mit ISBN, Verlag und Druckerei im Buch' },
    ],
  },
  {
    stufe: 'druckfreigabe',
    titel: 'Druckfreigabe',
    schritte: [
      { id: 'druckangebot', label: 'Druckangebote eingeholt und verglichen' },
      { id: 'probedruck', label: 'Probedruck geprüft' },
      { id: 'druckfreigabe', label: 'Druckfreigabe erteilt' },
    ],
  },
  {
    stufe: 'druck',
    titel: 'Druck & Lieferung',
    schritte: [
      { id: 'druck_beauftragt', label: 'Druck beauftragt' },
      { id: 'lieferung', label: 'Auflage geliefert und geprüft' },
    ],
  },
  {
    stufe: 'veroeffentlicht',
    titel: 'Veröffentlichung',
    schritte: [
      { id: 'pflichtexemplare', label: 'Pflichtexemplare an die Deutsche Nationalbibliothek' },
      { id: 'belegexemplare', label: 'Belegexemplare an Autor, Illustrator und Beteiligte' },
      { id: 'presse', label: 'Pressemitteilung und Rezensionsexemplare verschickt' },
    ],
  },
  {
    stufe: 'vertrieb',
    titel: 'Vertrieb & Lesungen',
    schritte: [
      { id: 'vertrieb_buchhandel', label: 'Vertrieb über den Buchhandel (Barsortiment, z. B. Libri oder Zeitfracht)' },
      { id: 'vertrieb_amazon', label: 'Vertrieb über Amazon' },
      { id: 'vertrieb_shop', label: 'Vertrieb über den eigenen Shop' },
      { id: 'lesungen', label: 'Lesungen und Termine geplant' },
    ],
  },
]

export const ALLE_SCHRITTE = BUCH_CHECKLISTE.flatMap((g) => g.schritte)

export const KONTAKT_ROLLEN = ['Autor', 'Illustrator', 'Lektor', 'Druckerei', 'Händler', 'Presse', 'Sonstige']

export function stufeLabel(s: string | null | undefined): string {
  return BUCH_STUFEN.find((x) => x.id === s)?.label ?? String(s ?? '')
}

/** Stufe aus Kennung oder Anzeigename („Im Druck“, „druck“, „Satz“) — sonst undefined. */
export function stufeVon(angabe: unknown): string | undefined {
  const t = String(angabe ?? '').trim().toLowerCase()
  if (!t) return undefined
  const genau = BUCH_STUFEN.find((s) => s.id === t || s.label.toLowerCase() === t)
  if (genau) return genau.id
  const teil = BUCH_STUFEN.filter((s) => s.label.toLowerCase().includes(t) || t.includes(s.id))
  return teil.length === 1 ? teil[0].id : undefined
}

export function fortschritt(checkliste: Record<string, boolean> | null | undefined): { erledigt: number; gesamt: number } {
  const c = checkliste ?? {}
  return { erledigt: ALLE_SCHRITTE.filter((s) => c[s.id] === true).length, gesamt: ALLE_SCHRITTE.length }
}

// ---------------------------------------------------------------------------------------------
// Rechte

/** Wie die Zeilenregel darf_bereich('buecher'): Geschäftsführung/Admins immer, sonst nur mit Freigabe „Bücher & Verlag“. */
export function darfBuecher(m: RechteMitarbeiter): boolean {
  return darfBereich(m, 'buecher')
}

export function buecherNichtFreigegeben(name?: string | null): string {
  const wer = name ? name : 'diesen Mitarbeiter'
  return `Nicht freigegeben: Der Bereich Bücher & Verlag ist für ${wer} nicht freigegeben. Bücher und Buch-Kontakte kannst du für ihn weder ansehen noch ändern. Sag ihm das so, ohne Titel oder Einzelheiten zu nennen; Zugriff gibt die Geschäftsführung.`
}

// ---------------------------------------------------------------------------------------------
// Felder

export type BuchZeile = {
  id: string
  titel: string
  untertitel: string | null
  reihe: string | null
  band: string | null
  autor: string | null
  illustrator: string | null
  lektorat: string | null
  zielgruppe: string | null
  format: string | null
  seitenzahl: number | null
  isbn: string | null
  auflage: number | null
  druckerei: string | null
  erscheinungstermin: string | null
  ladenpreis: number | string | null
  status: string
  checkliste: Record<string, boolean> | null
  notizen: string | null
  dokumente: { id: string; name: string; pfad: string; groesse?: string; hochgeladenAm?: string; hochgeladenVon?: string }[] | null
  verantwortlich: string | null
  erstellt_am: string
  geaendert_am: string
  geaendert_von: string | null
}

/** Textfelder, die der Assistent setzen darf (Spaltenname = Eingabename), wie SPALTEN in src/lib/buecher.ts. */
const TEXT_FELDER = ['untertitel', 'reihe', 'band', 'autor', 'illustrator', 'lektorat', 'zielgruppe', 'format', 'isbn', 'druckerei'] as const
const GANZZAHL_FELDER = ['seitenzahl', 'auflage'] as const

const FELD_NAME: Record<string, string> = {
  titel: 'Titel', untertitel: 'Untertitel', reihe: 'Reihe', band: 'Band', autor: 'Autor', illustrator: 'Illustrator',
  lektorat: 'Lektorat', zielgruppe: 'Zielgruppe', format: 'Format', seitenzahl: 'Seitenzahl', isbn: 'ISBN',
  auflage: 'Auflage', druckerei: 'Druckerei', erscheinungstermin: 'Erscheinungstermin', ladenpreis: 'Ladenpreis',
  status: 'Stufe', checkliste: 'Checkliste', notizen: 'Notizen', verantwortlich: 'Verantwortlich',
}

/** Zahl aus 12,90 / 12.90 / "1.200" / 12; leer → null; ungültig → undefined. Wie zahlAus in BuchDetail.tsx, nur erkennt diese hier „1.200“ als 1200. */
export function zahlAus(v: unknown, ganz: boolean): number | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? (ganz ? Math.round(v) : Math.round(v * 100) / 100) : undefined
  const t = String(v).trim().replace(/\s/g, '').replace(/€/g, '')
  if (!t) return null
  // Bei ganzen Zahlen (Seiten, Auflage) Punkte als Tausendertrennung, wenn kein Komma da ist und das Muster passt („1.200“ = 1200).
  const tausender = ganz && !t.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(t)
  const n = Number(t.includes(',') || tausender ? t.replace(/\./g, '').replace(',', '.') : t)
  if (!Number.isFinite(n)) return undefined
  return ganz ? Math.round(n) : Math.round(n * 100) / 100
}

function gleich(a: unknown, b: unknown): boolean {
  const n = (x: unknown) => (x === undefined || x === '' ? null : typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x)
  return JSON.stringify(n(a)) === JSON.stringify(n(b))
}

/**
 * Aus der Eingabe des Assistenten die zu schreibenden Spalten — nur, was sich gegenüber `vorher`
 * wirklich ändert (ohne `vorher`: alles Angegebene, für das Anlegen). Leerer Text löscht ein Feld
 * (außer dem Titel). Fehler als Text.
 */
// deno-lint-ignore no-explicit-any
export function buchAenderungAus(input: any, vorher?: BuchZeile | null): { spalten: Record<string, unknown>; fehler?: string } {
  const z: Record<string, unknown> = {}
  const setze = (spalte: string, wert: unknown) => {
    if (vorher && gleich((vorher as Record<string, unknown>)[spalte], wert)) return
    z[spalte] = wert
  }
  if (input?.titel !== undefined) {
    const t = String(input.titel ?? '').replace(/\s+/g, ' ').trim()
    if (!t) return { spalten: {}, fehler: 'Fehler: Der Titel darf nicht leer sein.' }
    setze('titel', t.slice(0, 300))
  }
  for (const f of TEXT_FELDER) {
    if (input?.[f] === undefined) continue
    setze(f, String(input[f] ?? '').trim() || null)
  }
  for (const f of GANZZAHL_FELDER) {
    if (input?.[f] === undefined) continue
    const n = zahlAus(input[f], true)
    if (n === undefined || (n !== null && n < 0)) return { spalten: {}, fehler: `Fehler: ${FELD_NAME[f]} ist keine gültige Zahl.` }
    setze(f, n)
  }
  if (input?.ladenpreis !== undefined) {
    const n = zahlAus(input.ladenpreis, false)
    if (n === undefined || (n !== null && n < 0)) return { spalten: {}, fehler: 'Fehler: Ladenpreis ist kein gültiger Betrag.' }
    setze('ladenpreis', n)
  }
  if (input?.erscheinungstermin !== undefined) {
    const roh = String(input.erscheinungstermin ?? '').trim()
    if (!roh) setze('erscheinungstermin', null)
    else {
      const iso = pruefeDatum(roh)
      if (!iso) return { spalten: {}, fehler: 'Fehler: erscheinungstermin ist kein gültiges Datum (JJJJ-MM-TT).' }
      setze('erscheinungstermin', iso)
    }
  }
  if (input?.stufe !== undefined && String(input.stufe).trim() !== '') {
    const s = stufeVon(input.stufe)
    if (!s) return { spalten: {}, fehler: `Fehler: Unbekannte Stufe „${input.stufe}“. Möglich: ${BUCH_STUFEN.map((x) => `${x.id} (${x.label})`).join(', ')}.` }
    setze('status', s)
  }
  if (input?.notizen !== undefined) setze('notizen', String(input.notizen ?? '').trim() || null)
  return { spalten: z }
}

/** Checkliste neu: aktuelle Häkchen plus/minus der genannten Schritte. Unbekannte Schritte → Fehler. */
export function checklisteMit(aktuell: Record<string, boolean> | null | undefined, erledigt: unknown, offen: unknown): { checkliste: Record<string, boolean>; fehler?: string; geaendert: string[] } {
  const c: Record<string, boolean> = { ...(aktuell && typeof aktuell === 'object' ? aktuell : {}) }
  const liste = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map((x) => String(x).trim()).filter(Boolean)
  const geaendert: string[] = []
  const finde = (angabe: string) => {
    const t = angabe.toLowerCase()
    return ALLE_SCHRITTE.find((s) => s.id === t) ?? (ALLE_SCHRITTE.filter((s) => s.label.toLowerCase() === t)[0])
  }
  for (const [werte, an] of [[liste(erledigt), true], [liste(offen), false]] as const) {
    for (const angabe of werte) {
      const s = finde(angabe)
      if (!s) return { checkliste: c, geaendert, fehler: `Fehler: Unbekannter Schritt „${angabe}“. Die Kennungen der Schritte stehen in buch_lesen.` }
      if (!!c[s.id] === an) continue
      if (an) c[s.id] = true
      else delete c[s.id]
      geaendert.push(`${s.label}: ${an ? 'erledigt' : 'wieder offen'}`)
    }
  }
  return { checkliste: c, geaendert }
}

function euro(n: unknown): string {
  const z = Number(n)
  return Number.isFinite(z) ? `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(z)} €` : ''
}

function wertText(spalte: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(leer)'
  if (spalte === 'status') return stufeLabel(String(v))
  if (spalte === 'ladenpreis') return euro(v)
  if (spalte === 'erscheinungstermin') return deDatum(String(v))
  if (spalte === 'notizen') return String(v).length > 80 ? `${String(v).slice(0, 80)} …` : String(v)
  return String(v)
}

function buchKurz(b: BuchZeile): string {
  const f = fortschritt(b.checkliste)
  const teile = [`„${b.titel}“${b.untertitel ? ` – ${b.untertitel}` : ''}`, `Stufe: ${stufeLabel(b.status)}`]
  if (b.autor) teile.push(`Autor: ${b.autor}`)
  if (b.reihe) teile.push(`Reihe: ${b.reihe}${b.band ? `, Band ${b.band}` : ''}`)
  teile.push(`Checkliste ${f.erledigt}/${f.gesamt}`)
  if (b.verantwortlich) teile.push(`verantwortlich: ${b.verantwortlich}`)
  if (b.erscheinungstermin) teile.push(`Erscheinung: ${deDatum(b.erscheinungstermin)}`)
  return `- ${teile.join(' | ')} (id=${b.id})`
}

// ---------------------------------------------------------------------------------------------
// Werkzeuge

const FELD_EIGENSCHAFTEN = {
  untertitel: { type: 'string' },
  reihe: { type: 'string' },
  band: { type: 'string', description: 'Band innerhalb der Reihe, z. B. "2".' },
  autor: { type: 'string' },
  illustrator: { type: 'string' },
  lektorat: { type: 'string', description: 'Wer das Lektorat macht.' },
  zielgruppe: { type: 'string', description: 'z. B. "Kinder 3–6 Jahre".' },
  format: { type: 'string', description: 'z. B. "Hardcover, 21 × 28 cm".' },
  seitenzahl: { type: 'integer' },
  isbn: { type: 'string' },
  auflage: { type: 'integer', description: 'Auflage in Stück.' },
  druckerei: { type: 'string' },
  erscheinungstermin: { type: 'string', description: 'JJJJ-MM-TT.' },
  ladenpreis: { type: 'number', description: 'Ladenpreis in Euro inkl. MwSt., z. B. 14.9.' },
  stufe: { type: 'string', enum: BUCH_STUFEN.map((s) => s.id), description: 'Stufe des Buchs.' },
  verantwortlich: { type: 'string', description: 'Name des zuständigen Mitarbeiters ("ich" = der Fragende).' },
}

export const BUECHER_WERKZEUGE = [
  {
    name: 'buecher_auflisten',
    description:
      'Listet die Bücher der Abteilung „Bücher & Verlag“ (eigene Bücher und Verlagsprojekte der Holding, z. B. Kinderbücher) mit Stufe, Autor, Fortschritt der Checkliste und Zuständigem. Für Fragen wie „Welche Bücher haben wir gerade?“, „Was ist im Druck?“. Liefert die IDs für buch_lesen und buch_aendern.',
    input_schema: {
      type: 'object',
      properties: {
        stufe: { type: 'string', enum: BUCH_STUFEN.map((s) => s.id), description: 'Nur Bücher dieser Stufe.' },
        suche: { type: 'string', description: 'Wort aus Titel, Untertitel, Reihe, Autor, Illustrator oder ISBN.' },
      },
    },
  },
  {
    name: 'buch_lesen',
    description:
      'Liest ein Buch vollständig: alle Angaben, Notizen, die Checkliste je Stufe (mit Kennung jedes Schritts für buch_aendern), die verknüpften Kontakte und die Liste der Dateien. Mit buch_id (aus buecher_auflisten) oder einem eindeutigen Titel.',
    input_schema: {
      type: 'object',
      properties: {
        buch_id: { type: 'string' },
        titel: { type: 'string', description: 'Titel oder Teil davon, wenn die id nicht bekannt ist.' },
      },
    },
  },
  {
    name: 'buch_anlegen',
    description:
      'Legt ein neues Buch in „Bücher & Verlag“ an (Stufe ohne Angabe: Idee). Nur auf Wunsch des Mitarbeiters. Vorher mit buecher_auflisten prüfen, ob es das Buch schon gibt.',
    input_schema: {
      type: 'object',
      properties: {
        titel: { type: 'string' },
        ...FELD_EIGENSCHAFTEN,
        notizen: { type: 'string' },
        doppelt_erlaubt: { type: 'boolean', description: 'Nur true, wenn der Mitarbeiter ausdrücklich ein zweites Buch mit gleichem Titel will (z. B. Neuauflage).' },
      },
      required: ['titel'],
    },
  },
  {
    name: 'buch_aendern',
    description:
      'Ändert ein Buch: Angaben (nur die genannten Felder, leerer Text löscht ein Feld), Stufe, Häkchen der Checkliste (schritte_erledigt / schritte_offen mit den Kennungen aus buch_lesen), Notizen ersetzen oder eine Notiz anhängen. Andere Felder bleiben unberührt. Für „Das Lektorat ist fertig“, „Setz das Buch auf Druck“, „ISBN ist 978-…“.',
    input_schema: {
      type: 'object',
      properties: {
        buch_id: { type: 'string' },
        titel: { type: 'string' },
        ...FELD_EIGENSCHAFTEN,
        schritte_erledigt: { type: 'array', items: { type: 'string' }, description: 'Kennungen der Schritte, die jetzt erledigt sind (z. B. "lektorat_abgeschlossen").' },
        schritte_offen: { type: 'array', items: { type: 'string' }, description: 'Kennungen der Schritte, deren Häkchen wieder weg soll.' },
        notizen: { type: 'string', description: 'Ersetzt die gesamten Notizen. Zum Ergänzen lieber notiz_anhaengen.' },
        notiz_anhaengen: { type: 'string', description: 'Hängt eine Zeile mit Datum und Namen an die Notizen an.' },
      },
      required: ['buch_id'],
    },
  },
  {
    name: 'buch_kontakte_suchen',
    description:
      'Sucht Kontakte der Abteilung „Bücher & Verlag“ (Autoren, Illustratoren, Lektoren, Druckereien, Händler, Presse) mit Rolle, Firma, E-Mail, Telefon und den Büchern, zu denen sie gehören. Ohne Angaben: alle.',
    input_schema: {
      type: 'object',
      properties: {
        suche: { type: 'string', description: 'Wort aus Name, Firma, E-Mail oder Notiz.' },
        rolle: { type: 'string', enum: KONTAKT_ROLLEN },
        buch_id: { type: 'string', description: 'Nur Kontakte dieses Buchs.' },
      },
    },
  },
]

export function istBuecherWerkzeug(name: string): boolean {
  return BUECHER_WERKZEUGE.some((w) => w.name === name)
}

const enthaelt = (feld: unknown, t: string) => String(feld ?? '').toLowerCase().includes(t)

async function ladeBuch(supabase: Supa, id: string): Promise<{ buch?: BuchZeile; fehler?: string }> {
  if (!id) return { fehler: 'Fehler: buch_id fehlt. Ermittle sie mit buecher_auflisten.' }
  const { data, error } = await supabase.from('buecher').select('*').eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden: ${error.message}` }
  if (!data) return { fehler: 'Fehler: Dieses Buch gibt es nicht. Ermittle die id mit buecher_auflisten.' }
  return { buch: data as BuchZeile }
}

/** Mitarbeiter-Name eindeutig zuordnen („ich“ = Fragender). Fehler als Text. */
async function verantwortlichAus(supabase: Supa, angabe: unknown, ich: string): Promise<{ name: string | null; fehler?: string }> {
  const t = String(angabe ?? '').trim()
  if (!t) return { name: null }
  if (/^(ich|mir|mich|selbst)$/i.test(t)) return { name: ich }
  const { data } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
  const voll = ((data ?? []) as { name: string }[]).map((m) => m.name).filter(Boolean)
  const exakt = voll.find((n) => n.toLowerCase() === t.toLowerCase())
  if (exakt) return { name: exakt }
  const { personen } = ordneZu(t, personenNamen(voll))
  if (personen.length === 1) return { name: personen[0] }
  return { name: null, fehler: `Fehler: „${t}“ ist kein eindeutiger Mitarbeiter. Im Team sind: ${personenNamen(voll).join(', ')}.` }
}

// deno-lint-ignore no-explicit-any
export async function fuehreBuecherWerkzeugAus(name: string, input: any, k: BuecherKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (!darfBuecher(mitarbeiter)) return buecherNichtFreigegeben(mitarbeiter.name)

  if (name === 'buecher_auflisten') {
    const { data, error } = await supabase.from('buecher').select('*').order('geaendert_am', { ascending: false }).limit(500)
    if (error) return `Fehler beim Laden: ${error.message}`
    let liste = (data ?? []) as BuchZeile[]
    let kopf = 'Bücher'
    if (input?.stufe) {
      const s = stufeVon(input.stufe)
      if (!s) return `Fehler: Unbekannte Stufe „${input.stufe}“.`
      liste = liste.filter((b) => b.status === s)
      kopf += ` in der Stufe ${stufeLabel(s)}`
    }
    const suche = String(input?.suche ?? '').trim().toLowerCase()
    if (suche) {
      liste = liste.filter((b) => [b.titel, b.untertitel, b.reihe, b.autor, b.illustrator, b.isbn].some((f) => enthaelt(f, suche)))
      kopf += ` mit „${input.suche}“`
    }
    if (!liste.length) return `${kopf}: keine.`
    // Reihenfolge wie die Stufen im CRM, innerhalb der Stufe zuletzt geändert zuerst.
    const rang = (s: string) => BUCH_STUFEN.findIndex((x) => x.id === s)
    liste.sort((a, b) => rang(a.status) - rang(b.status) || String(b.geaendert_am).localeCompare(String(a.geaendert_am)))
    return [`${kopf}: ${liste.length}.`, ...liste.slice(0, 80).map(buchKurz), liste.length > 80 ? `… und ${liste.length - 80} weitere.` : ''].filter(Boolean).join('\n')
  }

  if (name === 'buch_lesen') {
    let buch: BuchZeile | undefined
    const id = String(input?.buch_id ?? '').trim()
    if (id) {
      const r = await ladeBuch(supabase, id)
      if (r.fehler) return r.fehler
      buch = r.buch
    } else {
      const t = String(input?.titel ?? '').trim().toLowerCase()
      if (!t) return 'Fehler: buch_id oder titel angeben.'
      const { data } = await supabase.from('buecher').select('*').limit(500)
      const alle = (data ?? []) as BuchZeile[]
      const treffer = alle.filter((b) => b.titel.toLowerCase() === t)
      const teil = treffer.length ? treffer : alle.filter((b) => enthaelt(b.titel, t) || enthaelt(b.untertitel, t))
      if (!teil.length) return `Kein Buch mit „${input.titel}“ im Titel.`
      if (teil.length > 1) return [`Mehrere Bücher passen — bitte nachfragen:`, ...teil.slice(0, 20).map(buchKurz)].join('\n')
      buch = teil[0]
    }
    const b = buch!
    const angaben = (['untertitel', 'reihe', 'band', 'autor', 'illustrator', 'lektorat', 'zielgruppe', 'format', 'seitenzahl', 'isbn', 'auflage', 'druckerei', 'erscheinungstermin', 'ladenpreis', 'verantwortlich'] as const)
      .filter((f) => b[f] !== null && b[f] !== undefined && b[f] !== '')
      .map((f) => `${FELD_NAME[f]}: ${wertText(f, b[f])}`)
    const f = fortschritt(b.checkliste)
    const c = b.checkliste ?? {}
    const checkliste = BUCH_CHECKLISTE.map((g) => {
      const zeilen = g.schritte.map((s) => `  [${c[s.id] ? 'x' : ' '}] ${s.label} (${s.id})`)
      return `${g.titel}${g.stufe === b.status ? ' ← aktuelle Stufe' : ''}:\n${zeilen.join('\n')}`
    })
    const { data: kontaktZeilen } = await supabase.from('buch_kontakte').select('*').order('name').limit(1000)
    const kontakte = ((kontaktZeilen ?? []) as { id: string; name: string; rolle: string; firma: string | null; email: string | null; telefon: string | null; buch_ids: string[] | null }[])
      .filter((x) => Array.isArray(x.buch_ids) && x.buch_ids.includes(b.id))
    const dateien = Array.isArray(b.dokumente) ? b.dokumente : []
    return [
      `Buch „${b.titel}“ (id=${b.id}), Stufe: ${stufeLabel(b.status)}, Checkliste ${f.erledigt}/${f.gesamt} erledigt.`,
      angaben.length ? angaben.join('\n') : 'Weitere Angaben: keine.',
      b.notizen ? `Notizen:\n${b.notizen.slice(0, 4000)}` : 'Notizen: keine.',
      `Checkliste (x = erledigt, Kennung in Klammern):\n${checkliste.join('\n')}`,
      kontakte.length
        ? `Kontakte (${kontakte.length}):\n${kontakte.map((x) => `- ${x.name} (${x.rolle})${x.firma ? `, ${x.firma}` : ''}${x.email ? `, ${x.email}` : ''}${x.telefon ? `, ${x.telefon}` : ''} (id=${x.id})`).join('\n')}`
        : 'Kontakte: keine verknüpft.',
      dateien.length
        ? `Dateien (${dateien.length}, öffnen im CRM unter Bücher & Verlag):\n${dateien.map((d) => `- ${d.name}${d.groesse ? `, ${d.groesse}` : ''}${d.hochgeladenAm ? `, hochgeladen ${deDatum(d.hochgeladenAm)}` : ''}${d.hochgeladenVon ? ` von ${d.hochgeladenVon}` : ''}`).join('\n')}`
        : 'Dateien: keine.',
      `Zuletzt geändert: ${deDatum(b.geaendert_am)}${b.geaendert_von ? ` von ${b.geaendert_von}` : ''}.`,
    ].join('\n\n').slice(0, 16000)
  }

  if (name === 'buch_anlegen') {
    const { spalten, fehler } = buchAenderungAus(input)
    if (fehler) return fehler
    if (!spalten.titel) return 'Fehler: titel fehlt.'
    if (input?.verantwortlich !== undefined) {
      const v = await verantwortlichAus(supabase, input.verantwortlich, mitarbeiter.name)
      if (v.fehler) return v.fehler
      spalten.verantwortlich = v.name
    }
    if (input?.doppelt_erlaubt !== true) {
      const { data: alle } = await supabase.from('buecher').select('id, titel').limit(1000)
      const vorhanden = ((alle ?? []) as { id: string; titel: string }[]).find((b) => b.titel.trim().toLowerCase() === String(spalten.titel).toLowerCase())
      if (vorhanden) return `Nicht angelegt: Es gibt schon ein Buch „${vorhanden.titel}“ (id=${vorhanden.id}). Ändere es mit buch_aendern — oder, wenn der Mitarbeiter ausdrücklich ein zweites will, doppelt_erlaubt=true.`
    }
    // Wie legeBuchAn: angegebene Felder, geaendert_von; id, Stufe (idee), Checkliste und Dateien setzt die Datenbank.
    const { data, error } = await supabase.from('buecher').insert({ ...spalten, geaendert_von: mitarbeiter.name }).select('*').single()
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    const neu = data as BuchZeile
    protokolliere(`Buch „${neu.titel}“ in Bücher & Verlag angelegt (Stufe ${stufeLabel(neu.status ?? 'idee')})`)
    return `Angelegt: Buch „${neu.titel}“, Stufe ${stufeLabel(neu.status ?? 'idee')}. Im CRM unter Bücher & Verlag. id=${neu.id}`
  }

  if (name === 'buch_aendern') {
    const r = await ladeBuch(supabase, String(input?.buch_id ?? '').trim())
    if (r.fehler) return r.fehler
    const vorher = r.buch!
    const { spalten, fehler } = buchAenderungAus(input, vorher)
    if (fehler) return fehler
    if (input?.verantwortlich !== undefined) {
      const v = await verantwortlichAus(supabase, input.verantwortlich, mitarbeiter.name)
      if (v.fehler) return v.fehler
      if (!gleich(vorher.verantwortlich, v.name)) spalten.verantwortlich = v.name
    }
    const meldungen: string[] = []
    if (input?.schritte_erledigt !== undefined || input?.schritte_offen !== undefined) {
      const c = checklisteMit(vorher.checkliste, input.schritte_erledigt, input.schritte_offen)
      if (c.fehler) return c.fehler
      if (c.geaendert.length) {
        spalten.checkliste = c.checkliste
        meldungen.push(...c.geaendert)
      }
    }
    const anhang = String(input?.notiz_anhaengen ?? '').trim()
    if (anhang) {
      const basis = spalten.notizen !== undefined ? String(spalten.notizen ?? '') : String(vorher.notizen ?? '')
      spalten.notizen = `${basis ? `${basis.trimEnd()}\n` : ''}${deDatum(heute)} (${mitarbeiter.name}): ${anhang}`
    }
    const felder = Object.keys(spalten)
    if (!felder.length) return `Nichts geändert: „${vorher.titel}“ hat diese Angaben schon.`
    // Wie aendereBuch: nur die geänderten Spalten, dazu geaendert_am und geaendert_von.
    const { data, error } = await supabase
      .from('buecher')
      .update({ ...spalten, geaendert_am: new Date().toISOString(), geaendert_von: mitarbeiter.name })
      .eq('id', vorher.id)
      .select('*')
      .single()
    if (error) return `Fehler beim Speichern: ${error.message}`
    const neu = data as BuchZeile
    const teile = felder
      .filter((f) => f !== 'checkliste')
      .map((f) => (f === 'notizen' && anhang ? 'Notiz angehängt' : `${FELD_NAME[f] ?? f}: ${wertText(f, vorher[f as keyof BuchZeile])} → ${wertText(f, spalten[f])}`))
    if (spalten.checkliste) {
      const fo = fortschritt(neu.checkliste ?? (spalten.checkliste as Record<string, boolean>))
      teile.push(`Checkliste: ${meldungen.join('; ')} (jetzt ${fo.erledigt}/${fo.gesamt})`)
    }
    protokolliere(`Buch „${neu.titel}“ geändert: ${teile.join('; ')}`.slice(0, 500))
    return `Geändert: Buch „${neu.titel}“ — ${teile.join('; ')}. id=${neu.id}`
  }

  if (name === 'buch_kontakte_suchen') {
    const { data, error } = await supabase.from('buch_kontakte').select('*').order('name').limit(1000)
    if (error) return `Fehler beim Laden: ${error.message}`
    type K = { id: string; name: string; rolle: string; firma: string | null; email: string | null; telefon: string | null; notiz: string | null; buch_ids: string[] | null }
    let liste = (data ?? []) as K[]
    const teile: string[] = []
    const rolle = String(input?.rolle ?? '').trim()
    if (rolle) {
      liste = liste.filter((x) => x.rolle.toLowerCase() === rolle.toLowerCase())
      teile.push(`Rolle ${rolle}`)
    }
    const buchId = String(input?.buch_id ?? '').trim()
    if (buchId) {
      liste = liste.filter((x) => Array.isArray(x.buch_ids) && x.buch_ids.includes(buchId))
      teile.push('zum genannten Buch')
    }
    const suche = String(input?.suche ?? '').trim().toLowerCase()
    if (suche) {
      liste = liste.filter((x) => [x.name, x.firma, x.email, x.notiz, x.telefon].some((f) => enthaelt(f, suche)))
      teile.push(`mit „${input.suche}“`)
    }
    const kopf = `Buch-Kontakte${teile.length ? ` (${teile.join(', ')})` : ''}`
    if (!liste.length) return `${kopf}: keine.`
    const ids = [...new Set(liste.flatMap((x) => (Array.isArray(x.buch_ids) ? x.buch_ids : [])))]
    const titel = new Map<string, string>()
    if (ids.length) {
      const { data: b } = await supabase.from('buecher').select('id, titel').in('id', ids)
      for (const x of (b ?? []) as { id: string; titel: string }[]) titel.set(x.id, x.titel)
    }
    return [
      `${kopf}: ${liste.length}.`,
      ...liste.slice(0, 80).map((x) => {
        const z = [`${x.name} (${x.rolle})`]
        if (x.firma) z.push(x.firma)
        if (x.email) z.push(x.email)
        if (x.telefon) z.push(x.telefon)
        const buecher = (x.buch_ids ?? []).map((id) => titel.get(id)).filter(Boolean)
        if (buecher.length) z.push(`Bücher: ${buecher.map((t) => `„${t}“`).join(', ')}`)
        if (x.notiz) z.push(`Notiz: ${x.notiz.slice(0, 200)}`)
        return `- ${z.join(' | ')} (id=${x.id})`
      }),
      liste.length > 80 ? `… und ${liste.length - 80} weitere (eingrenzen).` : '',
    ].filter(Boolean).join('\n').slice(0, 16000)
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
