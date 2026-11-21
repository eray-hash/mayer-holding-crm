// Bücher & Verlag (Wunsch von Eray, 21.11.2026: "Eigene Bücher / Verlag" — Bücher, die die Holding
// selbst schreibt oder herausgibt, z. B. Kinderbücher). Tabellen `buecher` und `buch_kontakte`.
// Zugriff regelt die Datenbank: aktive Mitarbeiter (ist_aktiver_mitarbeiter) und zusätzlich die
// einschränkende Regel darf_bereich('buecher') — Geschäftsführung/Admins sehen alles, alle anderen nur
// mit Freigabe "Bücher & Verlag" in der Mitarbeiter-Verwaltung.
// Dateien liegen im privaten Speicher "kunden-dokumente" unter buecher/<buch-id>/….
import { supabase } from './supabaseClient'
import { uid } from './dates'
import { BUECHER_HAUPTPFAD, BUECHER_STATUS } from '../data/statusNetworks'

export type BuchStatus =
  | 'idee'
  | 'manuskript'
  | 'lektorat'
  | 'illustration'
  | 'satz'
  | 'druckfreigabe'
  | 'druck'
  | 'veroeffentlicht'
  | 'vertrieb'
  | 'ruht'

/** Alle Stufen in Anzeige-Reihenfolge (Hauptpfad, danach "Ruht"). */
export const BUCH_STUFEN: { id: BuchStatus; label: string; farbe: string }[] = [...BUECHER_HAUPTPFAD, 'ruht'].map((id) => ({
  id: id as BuchStatus,
  label: BUECHER_STATUS[id].label,
  farbe: BUECHER_STATUS[id].color,
}))

export function stufeLabel(s: string): string {
  return BUECHER_STATUS[s]?.label ?? s
}

export type BuchDokument = {
  id: string
  name: string
  pfad: string
  groesse: string
  hochgeladenAm: string
  hochgeladenVon?: string
}

export type Buch = {
  id: string
  titel: string
  untertitel?: string
  reihe?: string
  band?: string
  autor?: string
  illustrator?: string
  lektorat?: string
  zielgruppe?: string
  format?: string
  seitenzahl?: number
  isbn?: string
  auflage?: number
  druckerei?: string
  erscheinungstermin?: string
  ladenpreis?: number
  status: BuchStatus
  checkliste: Record<string, boolean>
  notizen?: string
  dokumente: BuchDokument[]
  verantwortlich?: string
  erstelltAm: string
  geaendertAm: string
  geaendertVon?: string
}

export type BuchKontaktRolle = 'Autor' | 'Illustrator' | 'Lektor' | 'Druckerei' | 'Händler' | 'Presse' | 'Sonstige'
export const KONTAKT_ROLLEN: BuchKontaktRolle[] = ['Autor', 'Illustrator', 'Lektor', 'Druckerei', 'Händler', 'Presse', 'Sonstige']

export type BuchKontakt = {
  id: string
  name: string
  rolle: BuchKontaktRolle
  firma?: string
  email?: string
  telefon?: string
  notiz?: string
  buchIds: string[]
}

// ---------------------------------------------------------------------------------------------
// Standard-Schritte je Stufe (übliche Abläufe im deutschen Buchmarkt). Die Häkchen landen in
// buecher.checkliste als { schrittId: true }.

export type BuchSchritt = { id: string; label: string; hinweis?: string }

export const BUCH_CHECKLISTE: { stufe: BuchStatus; titel: string; schritte: BuchSchritt[] }[] = [
  {
    stufe: 'idee',
    titel: 'Idee & Planung',
    schritte: [
      { id: 'konzept', label: 'Idee und Zielgruppe festgehalten' },
      { id: 'kalkulation', label: 'Grobe Kalkulation (Auflage, Druckkosten, Ladenpreis)' },
      { id: 'vertrag_autor', label: 'Vertrag mit Autor geschlossen', hinweis: 'Bei eigenen Texten entfällt das.' },
    ],
  },
  {
    stufe: 'manuskript',
    titel: 'Manuskript',
    schritte: [{ id: 'manuskript_fertig', label: 'Manuskript fertig' }],
  },
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
      { id: 'illustration_beauftragt', label: 'Illustrationen beauftragt', hinweis: 'Nutzungsrechte schriftlich regeln.' },
      { id: 'illustration_abgenommen', label: 'Illustrationen abgenommen' },
    ],
  },
  {
    stufe: 'satz',
    titel: 'Satz, Gestaltung & Nummern',
    schritte: [
      { id: 'satz_layout', label: 'Satz und Gestaltung der Innenseiten' },
      { id: 'cover', label: 'Umschlag (Cover) fertig' },
      { id: 'isbn', label: 'ISBN beantragt', hinweis: 'Bei der ISBN-Agentur der MVB (Marketing- und Verlagsservice des Buchhandels).' },
      { id: 'vlb', label: 'Eintrag im Verzeichnis lieferbarer Bücher (VLB)', hinweis: 'Damit der Buchhandel das Buch findet und bestellen kann.' },
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
      { id: 'pflichtexemplare', label: 'Pflichtexemplare an die Deutsche Nationalbibliothek', hinweis: 'Zwei Exemplare, innerhalb einer Woche nach Erscheinen; je nach Bundesland zusätzlich an die Landesbibliothek.' },
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

export function fortschritt(b: Pick<Buch, 'checkliste'>): { erledigt: number; gesamt: number } {
  return { erledigt: ALLE_SCHRITTE.filter((s) => b.checkliste[s.id]).length, gesamt: ALLE_SCHRITTE.length }
}

// ---------------------------------------------------------------------------------------------
// Datenbank

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

function fehler(e: { message?: string } | null, was = 'Buch'): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für „Bücher & Verlag“ hast du keine Berechtigung.')
  return new Error(m ? `${was} ließ sich nicht speichern: ${m}` : `${was} ließ sich nicht speichern.`)
}

const leer = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : v)
const zahl = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buchAusZeile(z: any): Buch {
  return {
    id: z.id,
    titel: z.titel,
    untertitel: leer(z.untertitel) as string | undefined,
    reihe: leer(z.reihe) as string | undefined,
    band: leer(z.band) as string | undefined,
    autor: leer(z.autor) as string | undefined,
    illustrator: leer(z.illustrator) as string | undefined,
    lektorat: leer(z.lektorat) as string | undefined,
    zielgruppe: leer(z.zielgruppe) as string | undefined,
    format: leer(z.format) as string | undefined,
    seitenzahl: zahl(z.seitenzahl),
    isbn: leer(z.isbn) as string | undefined,
    auflage: zahl(z.auflage),
    druckerei: leer(z.druckerei) as string | undefined,
    erscheinungstermin: leer(z.erscheinungstermin) as string | undefined,
    ladenpreis: zahl(z.ladenpreis),
    status: z.status,
    checkliste: z.checkliste && typeof z.checkliste === 'object' ? z.checkliste : {},
    notizen: leer(z.notizen) as string | undefined,
    dokumente: Array.isArray(z.dokumente) ? z.dokumente : [],
    verantwortlich: leer(z.verantwortlich) as string | undefined,
    erstelltAm: z.erstellt_am,
    geaendertAm: z.geaendert_am,
    geaendertVon: leer(z.geaendert_von) as string | undefined,
  }
}

export type BuchAenderung = Partial<Omit<Buch, 'id' | 'erstelltAm' | 'geaendertAm' | 'geaendertVon'>>

const SPALTEN: Record<string, string> = {
  titel: 'titel', untertitel: 'untertitel', reihe: 'reihe', band: 'band', autor: 'autor', illustrator: 'illustrator',
  lektorat: 'lektorat', zielgruppe: 'zielgruppe', format: 'format', seitenzahl: 'seitenzahl', isbn: 'isbn',
  auflage: 'auflage', druckerei: 'druckerei', erscheinungstermin: 'erscheinungstermin', ladenpreis: 'ladenpreis',
  status: 'status', checkliste: 'checkliste', notizen: 'notizen', dokumente: 'dokumente', verantwortlich: 'verantwortlich',
}

/** Nur die übergebenen Felder als Datenbank-Spalten; leere Texte und ungültige Zahlen werden zu NULL. */
function buchZeile(e: BuchAenderung): Record<string, unknown> {
  const z: Record<string, unknown> = {}
  for (const [feld, wert] of Object.entries(e)) {
    const spalte = SPALTEN[feld]
    if (!spalte) continue
    if (typeof wert === 'string') z[spalte] = feld === 'titel' ? wert.trim() : wert.trim() || null
    else if (typeof wert === 'number') z[spalte] = Number.isFinite(wert) ? wert : null
    else z[spalte] = wert === undefined ? null : wert
  }
  return z
}

export async function ladeBuecher(): Promise<Buch[]> {
  const { data, error } = await client().from('buecher').select('*').order('geaendert_am', { ascending: false })
  if (error) throw fehler(error)
  return (data ?? []).map(buchAusZeile)
}

export async function ladeBuch(id: string): Promise<Buch | null> {
  const { data, error } = await client().from('buecher').select('*').eq('id', id).maybeSingle()
  if (error) throw fehler(error)
  return data ? buchAusZeile(data) : null
}

export async function legeBuchAn(e: BuchAenderung & { titel: string }, von: string): Promise<Buch> {
  const { data, error } = await client()
    .from('buecher')
    .insert({ ...buchZeile(e), geaendert_von: von })
    .select('*')
    .single()
  if (error) throw fehler(error)
  return buchAusZeile(data)
}

export async function aendereBuch(id: string, e: BuchAenderung, von: string): Promise<Buch> {
  const { data, error } = await client()
    .from('buecher')
    .update({ ...buchZeile(e), geaendert_am: new Date().toISOString(), geaendert_von: von })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw fehler(error)
  return buchAusZeile(data)
}

export async function loescheBuch(b: Buch): Promise<void> {
  const { error } = await client().from('buecher').delete().eq('id', b.id)
  if (error) throw fehler(error)
  const pfade = b.dokumente.map((d) => d.pfad).filter(Boolean)
  if (pfade.length) await client().storage.from(BUCKET).remove(pfade)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kontaktAusZeile(z: any): BuchKontakt {
  return {
    id: z.id,
    name: z.name,
    rolle: z.rolle,
    firma: leer(z.firma) as string | undefined,
    email: leer(z.email) as string | undefined,
    telefon: leer(z.telefon) as string | undefined,
    notiz: leer(z.notiz) as string | undefined,
    buchIds: Array.isArray(z.buch_ids) ? z.buch_ids : [],
  }
}

export type KontaktAenderung = Partial<Omit<BuchKontakt, 'id'>>

function kontaktZeile(e: KontaktAenderung): Record<string, unknown> {
  const z: Record<string, unknown> = {}
  if (e.name !== undefined) z.name = e.name.trim()
  if (e.rolle !== undefined) z.rolle = e.rolle
  if (e.firma !== undefined) z.firma = e.firma.trim() || null
  if (e.email !== undefined) z.email = e.email.trim() || null
  if (e.telefon !== undefined) z.telefon = e.telefon.trim() || null
  if (e.notiz !== undefined) z.notiz = e.notiz.trim() || null
  if (e.buchIds !== undefined) z.buch_ids = e.buchIds
  return z
}

export async function ladeBuchKontakte(): Promise<BuchKontakt[]> {
  const { data, error } = await client().from('buch_kontakte').select('*').order('name')
  if (error) throw fehler(error, 'Kontakt')
  return (data ?? []).map(kontaktAusZeile)
}

export async function legeBuchKontaktAn(e: KontaktAenderung & { name: string }, von: string): Promise<BuchKontakt> {
  const { data, error } = await client()
    .from('buch_kontakte')
    .insert({ ...kontaktZeile(e), geaendert_von: von })
    .select('*')
    .single()
  if (error) throw fehler(error, 'Kontakt')
  return kontaktAusZeile(data)
}

export async function aendereBuchKontakt(id: string, e: KontaktAenderung, von: string): Promise<BuchKontakt> {
  const { data, error } = await client()
    .from('buch_kontakte')
    .update({ ...kontaktZeile(e), geaendert_am: new Date().toISOString(), geaendert_von: von })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw fehler(error, 'Kontakt')
  return kontaktAusZeile(data)
}

export async function loescheBuchKontakt(id: string): Promise<void> {
  const { error } = await client().from('buch_kontakte').delete().eq('id', id)
  if (error) throw fehler(error, 'Kontakt')
}

// ---------------------------------------------------------------------------------------------
// Dateien (privater Speicher "kunden-dokumente", Ordner buecher/<id>/)

const BUCKET = 'kunden-dokumente'

function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Dateiname für den Speicher: ohne Umlaute, Leer- und Sonderzeichen (der Speicher lehnt manche Zeichen ab). */
export function speicherName(name: string): string {
  const ersetzt = name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+/, '')
  return ersetzt.slice(-120) || 'datei'
}

export async function ladeBuchDateiHoch(buchId: string, file: File, von: string): Promise<BuchDokument> {
  const id = uid('bdok')
  const pfad = `buecher/${buchId}/${id}_${speicherName(file.name)}`
  const { error } = await client().storage.from(BUCKET).upload(pfad, file, { contentType: file.type || undefined })
  if (error) throw new Error(`Datei ließ sich nicht hochladen: ${error.message}`)
  return { id, name: file.name, pfad, groesse: groesseText(file.size), hochgeladenAm: new Date().toISOString(), hochgeladenVon: von }
}

export async function buchDateiLink(pfad: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(pfad, 60 * 10)
  if (error) throw new Error(`Datei ließ sich nicht öffnen: ${error.message}`)
  return data.signedUrl
}

export async function loescheBuchDatei(pfad: string): Promise<void> {
  await client().storage.from(BUCKET).remove([pfad])
}
