// Assistent-Werkzeuge zum Verwalten von Dateien in Akten (22.11.2026). Anlass: offene Wünsche aus dem
// Team — „Dateien umbenennen“, „Datei nachträglich aus falscher Akte entfernen oder verschieben“,
// „Dateien vollständig löschen, inklusive Verlaufshinweis“, „Dateien aus einer Akte direkt an Kollegen
// schicken“.
//
//  - datei_verschieben: Dokument von einer Akte in eine andere — Kundenakte ↔ Kundenakte (auch die
//    Sammelakten k_intern_holding / k_eingang_ungeklaert), Kundenakte ↔ Objektakte, Objekt → Objekt.
//    Kunde → Objekt geht über dateien_ins_objekt (objektWerkzeuge.ts), damit Kopieren, Ordner und
//    Fassungen an einer Stelle bleiben.
//  - datei_umbenennen: Anzeigename (die Endung bleibt) und Art; in der Objektakte ist die Art der Ordner.
//  - datei_loeschen: nimmt den Eintrag aus der Akte und legt die Datei unter „aussortiert“ ab — nie
//    endgültig gelöscht, und nur, wenn keine andere Akte und kein Objekt dieselbe Datei noch nutzt.
//    Ohne bestaetigt=true wird nichts gelöscht, sondern eine Rückfrage beim Mitarbeiter verlangt.
//  - datei_an_kollegen: schickt ein Dokument per Telegram (sendeDokumentAnChat aus dateiSenden.ts) und
//    auf Wunsch per Mail an die Arbeitsadresse eines Kollegen. Der Kollege muss die Akte selbst sehen
//    dürfen; private Akten und Objekte gehen nie an andere.
//
// Wo Dateien liegen (siehe dateiSenden.ts speicherOrt): Kunden-Dokumente in kunden.dokumente (Liste),
// url = Pfad im privaten Eimer "kunden-dokumente" (<kundeId>/…), oder eine volle Adresse in
// "email-anhaenge" (Telegram: telegram/…, Mail-Anhänge), oder "privat:…" (persönliche Postfächer).
// Objekt-Dokumente in objekte.dokumente ({ Ordner: Dokument[] }), url = Pfad in "objekt-dokumente"
// (<objektId>/…). Die Speicherregel für private Akten und Objekte hängt am ersten Pfadteil
// (fremder_privater_ordner), deshalb zieht eine Datei aus dem Ordner einer Akte beim Verschieben als
// Kopie in den Ordner der Zielakte, und „aussortiert“ liegt unterhalb dieses ersten Pfadteils
// (<id>/aussortiert/…). Telegram-Dateien kommen wie bei dateien_aussortieren nach telegram-aussortiert/.
// Dateien, die nicht im Ordner der Akte liegen (Mail-Anhänge, persönliche Postfächer, fremde Ordner),
// bleiben beim Löschen, wo sie sind — sie gehören zu etwas anderem.
//
// Der Assistent arbeitet mit vollen Datenbankrechten; die Zeilenregeln bildet rechte.ts nach (Quelle und
// Ziel). Geschrieben werden nur die geänderten Spalten, die Listen (dokumente, activities) werden direkt
// vor dem Schreiben frisch gelesen.

import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { type Dok, findeDokument, findeKollege, sendeDokumentAnChat, speicherOrt } from './dateiSenden.ts'
import { formatGroesse, freierName, fuehreObjektSchreibWerkzeugAus, OBJEKT_ORDNER, ordnerVon, speicherName } from './objektWerkzeuge.ts'
import { bereichName, darfAkte, darfObjekt, istEigene, istFremdePrivatakte, istPrivat, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'
import { sensibleArt } from './sensibel.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type MailAuftrag = {
  an: string
  anName: string
  betreff: string
  text: string
  anhaenge: { filename: string; contentType?: string; contentBase64: string }[]
}

export type DateiKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; id?: string | null }
  protokolliere: (text: string) => void
  heute: string
  /** Für datei_an_kollegen per Telegram: Bot-Schlüssel (ohne Angabe TELEGRAM_BOT_TOKEN; null = Testlauf) und Ersatz für fetch in Tests. */
  botToken?: string | null
  abruf?: typeof fetch
  /** Für datei_an_kollegen per Mail: verschickt über email-gateway (action "send"). Fehlt er, geht nur Telegram. */
  sendeMail?: (m: MailAuftrag) => Promise<{ ok: boolean; fehler?: string }>
}

const KUNDEN_EIMER = 'kunden-dokumente'
const OBJEKT_EIMER = 'objekt-dokumente'
const TELEGRAM_EIMER = 'email-anhaenge'
const TELEGRAM_ORDNER = 'telegram'
/** Anhänge einer Mail höchstens so groß (wie WEITERLEITUNG_ANHAENGE_HOECHSTENS in mailWerkzeuge.ts). */
export const MAIL_GRENZE = 8 * 1024 * 1024

const KEIN_KUNDE = 'Fehler: Es gibt keine Kundenakte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
const KEIN_OBJEKT = 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
const KUNDE_SPALTEN = 'id, bereich, firma, ansprechpartner, verantwortlich_email, dokumente'
const OBJEKT_SPALTEN = 'id, bezeichnung, adresse, privat_besitzer, dokumente'

const dokumentWahl = {
  dokument_id: { type: 'string', description: 'Kennung des Dokuments (aus kundenakte_lesen oder objektakte_lesen), wenn bekannt.' },
  name: { type: 'string', description: 'Sonst: Dateiname oder ein Wort daraus. Bei mehreren Treffern kommt eine Liste zum Nachfragen.' },
}
const akteWahl = {
  kunde_id: { type: 'string', description: 'Kundenakte, in der das Dokument liegt (auch k_intern_holding oder k_eingang_ungeklaert).' },
  objekt_id: { type: 'string', description: 'Stattdessen: Objektakte, in der das Dokument liegt.' },
}

export const DATEI_VERWALTUNG_WERKZEUGE = [
  {
    name: 'datei_verschieben',
    description:
      'Verschiebt ein Dokument aus einer Akte in eine andere, z. B. wenn es beim falschen Kunden abgelegt wurde: Kundenakte → Kundenakte, Kundenakte → Objektakte, Objektakte → Kundenakte, Objektakte → Objektakte, auch aus und in die Sammelakten (Ungeklärte Eingänge, Unterlagen des Hauses). ' +
      'Das Dokument verschwindet aus der alten Akte und steht in der neuen; in beiden Akten kommt ein Eintrag in den Verlauf. Die Datei geht dabei nicht verloren. Quelle mit von_kunde_id oder von_objekt_id, Ziel mit nach_kunde_id, nach_objekt_id oder nach_ziel. Für eine Objektakte als Ziel den Ordner nach dem Inhalt wählen.',
    input_schema: {
      type: 'object',
      properties: {
        von_kunde_id: { type: 'string', description: 'Kundenakte, in der das Dokument jetzt liegt.' },
        von_objekt_id: { type: 'string', description: 'Stattdessen: Objektakte, in der das Dokument jetzt liegt.' },
        ...dokumentWahl,
        nach_kunde_id: { type: 'string', description: 'Kundenakte, in die es soll.' },
        nach_objekt_id: { type: 'string', description: 'Stattdessen: Objektakte, in die es soll.' },
        nach_ziel: { type: 'string', enum: ['intern', 'ungeklaert'], description: 'Stattdessen: intern = Unterlagen des Hauses (k_intern_holding), ungeklaert = Ungeklärte Eingänge (k_eingang_ungeklaert).' },
        ordner: { type: 'string', enum: [...OBJEKT_ORDNER], description: 'Nur bei einer Objektakte als Ziel: Ordner. Von Objekt zu Objekt ohne Angabe derselbe Ordner wie bisher.' },
        neuer_name: { type: 'string', description: 'Optional: zugleich ein neuer, sprechender Name (die Dateiendung bleibt).' },
        begruendung: { type: 'string', description: 'Optional: ein Satz, warum es umzieht. Er steht danach im Verlauf der Zielakte.' },
      },
    },
  },
  {
    name: 'datei_umbenennen',
    description:
      'Gibt einem Dokument in einer Kunden- oder Objektakte einen neuen Namen und/oder eine andere Art. Die Dateiendung (.pdf, .docx …) bleibt immer erhalten. In der Objektakte ist die Art der Ordner (das Dokument wandert dann in diesen Ordner). In den Verlauf der Akte kommt ein Eintrag mit altem und neuem Namen.',
    input_schema: {
      type: 'object',
      properties: {
        ...akteWahl,
        ...dokumentWahl,
        neuer_name: { type: 'string', description: 'Der neue Name, z. B. "Mietvertrag Teckstraße 2024".' },
        kategorie: { type: 'string', description: 'Optional: Art des Dokuments (z. B. Rechnung, Vertrag, Ausweis). Bei einer Objektakte einer ihrer Ordner, z. B. Grundbuch, Exposé, Verträge.' },
      },
    },
  },
  {
    name: 'datei_loeschen',
    description:
      'Löscht ein Dokument aus einer Kunden- oder Objektakte, mit Eintrag im Verlauf. Die Datei selbst wird nicht vernichtet, sondern unter „aussortiert“ aufbewahrt (nur wenn keine andere Akte sie noch nutzt). ' +
      'Nur auf ausdrücklichen Wunsch des Mitarbeiters. Der erste Aufruf (ohne bestaetigt) löscht nie, sondern liefert eine Zusammenfassung: Zeig sie dem Mitarbeiter und frag nach. Erst wenn er in seiner nächsten Nachricht klar zustimmt, mit bestaetigt=true erneut aufrufen. ' +
      'Soll ein Dokument nur in eine andere Akte, stattdessen datei_verschieben nutzen.',
    input_schema: {
      type: 'object',
      properties: {
        ...akteWahl,
        ...dokumentWahl,
        bestaetigt: { type: 'boolean', description: 'Erst true, nachdem der Mitarbeiter das Löschen dieses Dokuments ausdrücklich bestätigt hat.' },
      },
    },
  },
  {
    name: 'datei_an_kollegen',
    description:
      'Schickt ein Dokument aus einer Kunden- oder Objektakte an einen Kollegen: per Telegram als Datei (Standard) und auf Wunsch zusätzlich per Mail an seine Arbeitsadresse. Der Kollege muss die Akte selbst sehen dürfen; Dateien aus privaten Akten gehen nie an andere. ' +
      'Sensible Unterlagen (Ausweis, Kontoauszug, Steuer-, Gehalts- und Gesundheitsunterlagen, unterschriebene Verträge) gehen nicht über Telegram, wohl aber per Mail an die Arbeitsadresse. Im Verlauf der Akte wird vermerkt, wer was an wen geschickt hat.',
    input_schema: {
      type: 'object',
      properties: {
        ...akteWahl,
        ...dokumentWahl,
        an: { type: 'string', description: 'Name des Kollegen, z. B. "Quirin" oder "Andreas Mayer".' },
        nachricht: { type: 'string', description: 'Optional: kurzer Text dazu (höchstens 1000 Zeichen).' },
        per_telegram: { type: 'boolean', description: 'Ohne Angabe true. false = nicht per Telegram.' },
        per_mail: { type: 'boolean', description: 'true = zusätzlich (oder mit per_telegram=false nur) per Mail an die Arbeitsadresse des Kollegen.' },
      },
      required: ['an'],
    },
  },
]

export function istDateiVerwaltungsWerkzeug(name: string): boolean {
  return DATEI_VERWALTUNG_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Hilfen (rein) ----------

function text(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

function neueKennung(vorsatz: string): string {
  return `${vorsatz}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function akteTitel(a: { firma?: string | null; ansprechpartner?: string | null }): string {
  const f = text(a.firma)
  const p = text(a.ansprechpartner)
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

function objektTitel(o: { bezeichnung?: string | null; adresse?: string | null }): string {
  const b = text(o.bezeichnung) || 'Objekt ohne Bezeichnung'
  const a = text(o.adresse)
  return a && a !== b ? `„${b}“ (${a})` : `„${b}“`
}

const BEKANNTE_ENDUNGEN = /\.(pdf|docx?|xlsx?|xlsm|pptx?|csv|txt|rtf|odt|ods|jpe?g|png|gif|webp|heic|tiff?|zip|msg|eml)$/i

/** Neuer Anzeigename mit der Endung des alten („Vertrag“ + „scan.pdf“ → „Vertrag.pdf“); eine andere bekannte Endung wird ersetzt. */
export function behalteEndung(neu: string, alt: string): string {
  // deno-lint-ignore no-control-regex
  let n = text(neu).replace(/[\\/\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  const e = String(alt ?? '').match(/\.([A-Za-z0-9]{2,5})$/)?.[1]
  if (!n || !e) return n
  if (n.toLowerCase().endsWith(`.${e.toLowerCase()}`)) return n
  n = n.replace(BEKANNTE_ENDUNGEN, '').trim()
  return `${n}.${e}`
}

/** Speicherort eines Dokuments; in Objektakten ist ein reiner Pfad einer im Eimer "objekt-dokumente". */
export function dateiOrtVon(url: unknown, inObjekt: boolean): { eimer: string; pfad: string } | null {
  const u = String(url ?? '').trim()
  if (!u) return null
  const reinerPfad = !/^https?:\/\//i.test(u) && !u.startsWith('privat:') && !u.startsWith('objekt-dokumente:')
  return speicherOrt(inObjekt && reinerPfad ? `objekt-dokumente:${u}` : u)
}

/** Verweis, den speicherOrt (und damit dateiSenden.ts) richtig auflöst. */
function lesbarerVerweis(url: unknown, inObjekt: boolean): string {
  const ort = dateiOrtVon(url, inObjekt)
  if (!ort) return String(url ?? '')
  return ort.eimer === OBJEKT_EIMER ? `objekt-dokumente:${ort.pfad}` : String(url ?? '')
}

/**
 * Wohin eine Datei beim Löschen kommt — oder null, wenn sie bleibt, wo sie ist (gehört nicht zum Ordner
 * dieser Akte, z. B. ein Mail-Anhang, oder ist schon aussortiert).
 */
export function aussortierZiel(ort: { eimer: string; pfad: string }, besitzerId: string): string | null {
  const teile = ort.pfad.split('/')
  if (ort.eimer === TELEGRAM_EIMER) return teile.length === 2 && teile[0] === TELEGRAM_ORDNER ? `${TELEGRAM_ORDNER}-aussortiert/${teile[1]}` : null
  if (ort.eimer !== KUNDEN_EIMER && ort.eimer !== OBJEKT_EIMER) return null
  if (teile.length < 2 || teile[0] !== besitzerId || teile[1] === 'aussortiert') return null
  return `${teile[0]}/aussortiert/${teile.slice(1).join('/')}`
}

function bytesZuBase64(bytes: Uint8Array): string {
  let binaer = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binaer)
}

// ---------- Akten laden ----------

type KundeZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null; dokumente: Dok[] | null }
type ObjektZeile = { id: string; bezeichnung: string | null; adresse: string | null; privat_besitzer: string | null; dokumente: Record<string, Dok[]> | null }
type Ort = { art: 'kunde'; id: string; akte: KundeZeile } | { art: 'objekt'; id: string; objekt: ObjektZeile }
type Fund = { dok: Dok & Record<string, unknown>; ordner?: string }

function ortTitel(o: Ort): string {
  return o.art === 'kunde' ? `der Akte ${akteTitel(o.akte)}` : `der Objektakte ${objektTitel(o.objekt)}`
}

function idText(o: Ort): string {
  return o.art === 'kunde' ? `kunde_id=${o.id}` : `objekt_id=${o.id}`
}

async function ladeOrt(k: DateiKontext, kundeId: unknown, objektId: unknown, wofuer: string): Promise<Ort | string> {
  const kid = text(kundeId)
  const oid = text(objektId)
  if (kid && oid) return `Fehler: Für ${wofuer} bitte entweder eine Kundenakte oder eine Objektakte angeben, nicht beides.`
  if (!kid && !oid) return `Fehler: Für ${wofuer} fehlt die Akte (kunde_id oder objekt_id).`
  const { supabase, mitarbeiter } = k
  if (kid) {
    const { data, error } = await supabase.from('kunden').select(KUNDE_SPALTEN).eq('id', kid).maybeSingle()
    if (error) return `Fehler beim Laden der Akte: ${error.message}`
    if (!data || istFremdePrivatakte(mitarbeiter, data)) return KEIN_KUNDE
    if (!darfAkte(mitarbeiter, data)) return nichtFreigegeben(data.bereich, mitarbeiter.name)
    return { art: 'kunde', id: data.id, akte: data as KundeZeile }
  }
  const { data, error } = await supabase.from('objekte').select(OBJEKT_SPALTEN).eq('id', oid).maybeSingle()
  if (error) return `Fehler beim Laden des Objekts: ${error.message}`
  if (!data || istUnsichtbaresObjekt(mitarbeiter, data)) return KEIN_OBJEKT
  if (!darfObjekt(mitarbeiter, data)) return nichtFreigegeben('immobilien', mitarbeiter.name)
  return { art: 'objekt', id: data.id, objekt: data as ObjektZeile }
}

function objektListe(dokumente: unknown): Record<string, Dok[]> {
  return dokumente && typeof dokumente === 'object' && !Array.isArray(dokumente) ? { ...(dokumente as Record<string, Dok[]>) } : {}
}

function findeImOrt(o: Ort, dokId: unknown, suche: unknown): Fund | string {
  if (o.art === 'kunde') {
    const r = findeDokument(Array.isArray(o.akte.dokumente) ? o.akte.dokumente : [], text(dokId), text(suche))
    return 'meldung' in r ? r.meldung : { dok: r.dok as Fund['dok'] }
  }
  const ordnerVonDok = new Map<Dok, string>()
  const alle: Dok[] = []
  for (const [ordner, liste] of Object.entries(objektListe(o.objekt.dokumente))) {
    for (const d of Array.isArray(liste) ? liste : []) {
      ordnerVonDok.set(d, ordner)
      alle.push(d)
    }
  }
  const r = findeDokument(alle, text(dokId), text(suche))
  return 'meldung' in r ? r.meldung : { dok: r.dok as Fund['dok'], ordner: ordnerVonDok.get(r.dok) }
}

// ---------- Schreiben (nur geänderte Spalten, Listen frisch gelesen) ----------

function verlaufEintrag(k: DateiKontext, textInhalt: string) {
  return { id: crypto.randomUUID(), date: k.heute, text: textInhalt, user: k.mitarbeiter.name }
}

/** Liest dokumente/activities der Kundenakte frisch, wendet `aendern` an (null = abbrechen) und schreibt. Fehlertext oder null. */
async function schreibeKunde(k: DateiKontext, kundeId: string, aendern: ((doks: Dok[]) => Dok[] | null) | null, verlauf: string): Promise<string | null> {
  const { data, error } = await k.supabase.from('kunden').select('dokumente, activities').eq('id', kundeId).maybeSingle()
  if (error || !data) return error?.message ?? 'Die Akte gibt es nicht mehr.'
  const patch: Record<string, unknown> = { activities: [verlaufEintrag(k, verlauf), ...(Array.isArray(data.activities) ? data.activities : [])], letzte_aktivitaet: k.heute }
  if (aendern) {
    const neu = aendern(Array.isArray(data.dokumente) ? data.dokumente : [])
    if (!neu) return 'Das Dokument liegt nicht mehr in der Akte (inzwischen geändert). Lies die Akte neu.'
    patch.dokumente = neu
  }
  const { error: e2 } = await k.supabase.from('kunden').update(patch).eq('id', kundeId)
  return e2 ? e2.message : null
}

/** Wie schreibeKunde für Objekte; entfernte Dokumente fallen auch aus der Freigabe fürs Interessenten-Portal. */
async function schreibeObjekt(k: DateiKontext, objektId: string, aendern: ((doks: Record<string, Dok[]>) => Record<string, Dok[]> | null) | null, verlauf: string, wegIds: string[] = []): Promise<string | null> {
  const { data, error } = await k.supabase.from('objekte').select('dokumente, activities, interessenten_dokumente').eq('id', objektId).maybeSingle()
  if (error || !data) return error?.message ?? 'Das Objekt gibt es nicht mehr.'
  const patch: Record<string, unknown> = { activities: [verlaufEintrag(k, verlauf), ...(Array.isArray(data.activities) ? data.activities : [])], updated_at: new Date().toISOString() }
  if (aendern) {
    const neu = aendern(objektListe(data.dokumente))
    if (!neu) return 'Das Dokument liegt nicht mehr in der Objektakte (inzwischen geändert). Lies die Akte neu.'
    patch.dokumente = neu
  }
  const frei: unknown[] = Array.isArray(data.interessenten_dokumente) ? data.interessenten_dokumente : []
  if (wegIds.length && frei.some((x) => wegIds.includes(String(x)))) patch.interessenten_dokumente = frei.filter((x) => !wegIds.includes(String(x)))
  const { error: e2 } = await k.supabase.from('objekte').update(patch).eq('id', objektId)
  return e2 ? e2.message : null
}

/** Nimmt das Dokument mit dieser Kennung aus allen Ordnern; null, wenn es nicht (mehr) da ist. */
function ohneDokument(doks: Record<string, Dok[]>, dokId: string): Record<string, Dok[]> | null {
  let gefunden = false
  const neu: Record<string, Dok[]> = {}
  for (const [ordner, liste] of Object.entries(doks)) {
    const l = Array.isArray(liste) ? liste : []
    const rest = l.filter((d) => d?.id !== dokId)
    if (rest.length !== l.length) gefunden = true
    neu[ordner] = rest
  }
  return gefunden ? neu : null
}

// ---------- Speicher ----------

/** Lädt eine Datei aus dem eigenen Speicher (ohne Grenze oder mit `grenze`). Fehlertext oder Inhalt. */
async function ladeDatei(supabase: Supa, ort: { eimer: string; pfad: string } | null, grenze?: number): Promise<{ bytes: Uint8Array; typ: string } | string> {
  if (!ort) return 'Zu diesem Dokument ist keine Datei im eigenen Speicher hinterlegt.'
  const { data, error } = await supabase.storage.from(ort.eimer).download(ort.pfad)
  if (error || !data) return `Die Datei ist im Speicher nicht (mehr) vorhanden (${error?.message ?? 'unbekannt'}).`
  if (grenze && data.size > grenze) return `Die Datei ist ${formatGroesse(data.size)} groß — mehr als ${formatGroesse(grenze)} gehen nicht.`
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (grenze && bytes.length > grenze) return `Die Datei ist ${formatGroesse(bytes.length)} groß — mehr als ${formatGroesse(grenze)} gehen nicht.`
  return { bytes, typ: data.type || '' }
}

type Verwendung = { art: 'kunde' | 'objekt'; id: string; dokId: string; schluessel: string }

/** Alle Stellen in Kunden- und Objektakten, die auf eine Datei im eigenen Speicher zeigen. */
async function ladeVerwendungen(supabase: Supa): Promise<Verwendung[]> {
  // Vollständig und seitenweise: fehlte eine Akte (Grenze 1000 Zeilen je Abfrage), sähe eine benutzte Datei unbenutzt aus.
  const [{ data: kunden, error: e1 }, { data: objekte, error: e2 }] = await Promise.all([
    alleZeilen(() => supabase.from('kunden').select('id, dokumente')),
    alleZeilen(() => supabase.from('objekte').select('id, dokumente')),
  ])
  const fehler = e1 ?? e2
  if (fehler) throw new Error(`Verwendungen ließen sich nicht prüfen (${fehler.message})`)
  const aus: Verwendung[] = []
  for (const kz of (kunden ?? []) as { id: string; dokumente: unknown }[]) {
    for (const d of Array.isArray(kz.dokumente) ? (kz.dokumente as Dok[]) : []) {
      const ort = dateiOrtVon(d?.url, false)
      if (ort) aus.push({ art: 'kunde', id: kz.id, dokId: String(d.id ?? ''), schluessel: `${ort.eimer}/${ort.pfad}` })
    }
  }
  for (const oz of (objekte ?? []) as { id: string; dokumente: unknown }[]) {
    for (const liste of Object.values(objektListe(oz.dokumente))) {
      for (const d of Array.isArray(liste) ? liste : []) {
        const ort = dateiOrtVon(d?.url, true)
        if (ort) aus.push({ art: 'objekt', id: oz.id, dokId: String(d.id ?? ''), schluessel: `${ort.eimer}/${ort.pfad}` })
      }
    }
  }
  return aus
}

type Plan = { art: 'aussortieren'; ort: { eimer: string; pfad: string }; nach: string } | { art: 'verwendet' | 'bleibt' | 'keine_datei' }

/** Was mit der Datei passiert, wenn der Eintrag (ausnahme) aus der Akte verschwindet. */
async function planeAufbewahrung(k: DateiKontext, ort: { eimer: string; pfad: string } | null, besitzerId: string, ausnahme?: { art: 'kunde' | 'objekt'; id: string; dokId: string }): Promise<Plan> {
  if (!ort) return { art: 'keine_datei' }
  const nach = aussortierZiel(ort, besitzerId)
  if (!nach) return { art: 'bleibt' }
  const schluessel = `${ort.eimer}/${ort.pfad}`
  const verwendungen = await ladeVerwendungen(k.supabase)
  const anderswo = verwendungen.some((v) => v.schluessel === schluessel && !(ausnahme && v.art === ausnahme.art && v.id === ausnahme.id && v.dokId === ausnahme.dokId))
  return anderswo ? { art: 'verwendet' } : { art: 'aussortieren', ort, nach }
}

const PLAN_VERMERK: Record<Plan['art'], string> = {
  aussortieren: '(Datei aufbewahrt unter aussortiert)',
  verwendet: '(Datei bleibt gespeichert, sie liegt noch in einer anderen Akte)',
  bleibt: '(Datei bleibt unverändert gespeichert, sie gehört nicht zum Ordner dieser Akte)',
  keine_datei: '(es war keine Datei hinterlegt)',
}

/** Verschiebt die Datei nach „aussortiert“. Fehlertext oder null. Gibt es dort schon eine gleichnamige, mit Zeitstempel. */
async function fuehrePlanAus(k: DateiKontext, plan: Plan): Promise<string | null> {
  if (plan.art !== 'aussortieren') return null
  if (!istSichererPfad(plan.nach)) return 'Zielpfad nicht verwendbar.'
  const ablage = k.supabase.storage.from(plan.ort.eimer)
  const { error } = await ablage.move(plan.ort.pfad, plan.nach)
  if (!error) return null
  const teile = plan.nach.split('/')
  teile[teile.length - 1] = `${Date.now()}_${teile[teile.length - 1]}`
  const { error: e2 } = await ablage.move(plan.ort.pfad, teile.join('/'))
  return e2 ? e2.message : null
}

/** Nach einem Verschieben mit Kopie: die alte Datei aussortieren, wenn nichts mehr auf sie zeigt. Hinweistext oder ''. */
async function raeumeAltDateiAuf(k: DateiKontext, ort: { eimer: string; pfad: string } | null, besitzerId: string): Promise<string> {
  try {
    const plan = await planeAufbewahrung(k, ort, besitzerId)
    if (plan.art !== 'aussortieren') return ''
    const fehler = await fuehrePlanAus(k, plan)
    return fehler ? ` Die alte Datei ließ sich nicht aussortieren (${fehler}); sie liegt weiter im Speicher.` : ''
  } catch (e) {
    return ` Die alte Datei wurde nicht aussortiert (${e instanceof Error ? e.message : String(e)}).`
  }
}

// ---------- Werkzeuge ----------

// deno-lint-ignore no-explicit-any
export async function fuehreDateiVerwaltungAus(name: string, input: any, k: DateiKontext): Promise<string> {
  try {
    if (name === 'datei_verschieben') return await dateiVerschieben(input ?? {}, k)
    if (name === 'datei_umbenennen') return await dateiUmbenennen(input ?? {}, k)
    if (name === 'datei_loeschen') return await dateiLoeschen(input ?? {}, k)
    if (name === 'datei_an_kollegen') return await dateiAnKollegen(input ?? {}, k)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
  return `Fehler: unbekanntes Werkzeug ${name}.`
}

// deno-lint-ignore no-explicit-any
async function dateiVerschieben(input: any, k: DateiKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const quelle = await ladeOrt(k, input.von_kunde_id ?? input.kunde_id, input.von_objekt_id ?? input.objekt_id, 'die Quelle')
  if (typeof quelle === 'string') return quelle
  const zielKunde = input.nach_ziel === 'intern' ? SAMMELAKTEN[0] : input.nach_ziel === 'ungeklaert' ? SAMMELAKTEN[1] : input.nach_kunde_id
  if (input.nach_ziel && !['intern', 'ungeklaert'].includes(input.nach_ziel)) return 'Fehler: nach_ziel muss intern oder ungeklaert sein.'
  const ziel = await ladeOrt(k, zielKunde, input.nach_objekt_id, 'das Ziel')
  if (typeof ziel === 'string') return ziel
  if (quelle.art === ziel.art && quelle.id === ziel.id) return 'Fehler: Quelle und Ziel sind dieselbe Akte. Für einen anderen Namen oder Ordner datei_umbenennen nutzen.'
  const fund = findeImOrt(quelle, input.dokument_id, input.name)
  if (typeof fund === 'string') return fund
  const dok = fund.dok
  const dokId = String(dok.id ?? '')
  if (!dokId) return 'Fehler: Dieses Dokument hat keine Kennung und lässt sich nicht verschieben. Bitte im CRM verschieben.'
  const gewuenscht = text(input.neuer_name) ? behalteEndung(input.neuer_name, String(dok.name ?? '')) : String(dok.name ?? 'Dokument')
  const begruendung = text(input.begruendung).replace(/\.$/, '')
  const zusatz = begruendung ? ` — Grund: ${begruendung}` : ''
  const altOrt = dateiOrtVon(dok.url, quelle.art === 'objekt')

  // Kunde → Objekt: Kopieren, Ordner und Fassungen übernimmt dateien_ins_objekt; der Eintrag verschwindet aus der Kundenakte.
  if (quelle.art === 'kunde' && ziel.art === 'objekt') {
    const ordner = ordnerVon(input.ordner)
    if (!ordner) return `Fehler: Für die Objektakte fehlt ein gültiger Ordner. Möglich: ${OBJEKT_ORDNER.join(', ')}.`
    const ergebnis = await fuehreObjektSchreibWerkzeugAus(
      'dateien_ins_objekt',
      { objekt_id: ziel.id, dateien: [{ kunde_id: quelle.id, dokument_id: dokId, ordner, ...(gewuenscht !== dok.name ? { name: gewuenscht } : {}) }], aus_kundenakte_entfernen: true },
      k,
    )
    const { data: nachher } = await supabase.from('kunden').select('dokumente').eq('id', quelle.id).maybeSingle()
    const entfernt = !!nachher && !(Array.isArray(nachher.dokumente) ? nachher.dokumente : []).some((d: Dok) => d?.id === dokId)
    const aufraeumen = entfernt ? await raeumeAltDateiAuf(k, altOrt, quelle.id) : ''
    return `${ergebnis}${aufraeumen}`
  }

  // Alle anderen Wege: Eintrag im Ziel anlegen (bei Bedarf mit Kopie der Datei in den Ordner des Ziels), dann in der Quelle entfernen.
  let zielOrdner: string | undefined
  if (ziel.art === 'objekt') {
    zielOrdner = input.ordner ? ordnerVon(input.ordner) : fund.ordner
    if (!zielOrdner) return `Fehler: Für die Objektakte fehlt ein gültiger Ordner. Möglich: ${OBJEKT_ORDNER.join(', ')}.`
  }

  // Liegt dieselbe Datei schon im Ziel? Dann nur aus der Quelle nehmen.
  const altSchluessel = altOrt ? `${altOrt.eimer}/${altOrt.pfad}` : ''
  const zielDoks: Dok[] = ziel.art === 'kunde' ? (Array.isArray(ziel.akte.dokumente) ? ziel.akte.dokumente : []) : Object.values(objektListe(ziel.objekt.dokumente)).flatMap((l) => (Array.isArray(l) ? l : []))
  const schonDa = altSchluessel ? zielDoks.find((d) => { const o = dateiOrtVon(d?.url, ziel.art === 'objekt'); return !!o && `${o.eimer}/${o.pfad}` === altSchluessel }) : undefined

  // Muss die Datei mit? Ja, wenn das Ziel ein Objekt ist (Objekt-Dokumente liegen immer im Objekt-Eimer), wenn sie
  // aus dem Objekt-Eimer kommt (ein reiner Pfad hieße in der Kundenakte "kunden-dokumente") oder wenn sie im Ordner
  // der Quellakte liegt (erster Pfadteil = Quelle, daran hängt die Speicherregel für private Akten).
  const mussKopieren = !schonDa && (ziel.art === 'objekt' || (!!altOrt && (altOrt.eimer === OBJEKT_EIMER || (altOrt.eimer === KUNDEN_EIMER && altOrt.pfad.split('/')[0] === quelle.id))))
  let neu: Dok & Record<string, unknown> = { ...dok }
  delete neu.herkunft
  let kopie: { eimer: string; pfad: string } | null = null
  const meldungen: string[] = []

  if (!schonDa) {
    if (mussKopieren) {
      const geladen = await ladeDatei(supabase, altOrt)
      if (typeof geladen === 'string') return `Fehler: ${geladen} Nichts wurde verschoben.`
      const eimer = ziel.art === 'objekt' ? OBJEKT_EIMER : KUNDEN_EIMER
      const kennung = ziel.art === 'objekt' ? neueKennung('dok') : `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const pfad = `${ziel.id}/${kennung}_${speicherName(gewuenscht)}`
      if (!istSichererPfad(pfad)) return 'Fehler: Dateiname nicht verwendbar. Nichts wurde verschoben.'
      const typ = String(dok.typ || geladen.typ || 'application/octet-stream')
      const { error } = await supabase.storage.from(eimer).upload(pfad, geladen.bytes, { contentType: typ, upsert: false })
      if (error) return `Fehler: Die Datei ließ sich nicht in die Zielakte kopieren (${error.message}). Nichts wurde verschoben.`
      kopie = { eimer, pfad }
      neu = { ...neu, url: pfad, typ, groesse: String(dok.groesse || formatGroesse(geladen.bytes.length)), datum: String(dok.datum || heute) }
      if (ziel.art === 'kunde') delete neu.herkunft
    }
    if (ziel.art === 'objekt') {
      // Objekt-Dokumente tragen nur die Felder, die das CRM dort kennt.
      neu = { id: dokId, name: gewuenscht, typ: String(neu.typ ?? ''), datum: String(neu.datum || heute), groesse: String(neu.groesse ?? ''), url: String(neu.url ?? '') }
    }
  }

  // 1) Ziel schreiben.
  let endName = gewuenscht
  const herTitel = quelle.art === 'kunde' ? `aus der Akte ${akteTitel(quelle.akte)}` : `aus der Objektakte ${objektTitel(quelle.objekt)}${fund.ordner ? ` (Ordner ${fund.ordner})` : ''}`
  if (!schonDa) {
    const verlaufZiel = (n: string) => `Per Telegram von ${mitarbeiter.name} ${herTitel} hierher verschoben: „${n}“${zielOrdner ? ` (Ordner ${zielOrdner})` : ''}${zusatz}`
    let fehler: string | null
    if (ziel.art === 'kunde') {
      fehler = await schreibeKundeMitName(k, ziel.id, neu, gewuenscht, (n) => (endName = n), verlaufZiel)
    } else {
      fehler = await schreibeObjektMitName(k, ziel.id, zielOrdner!, neu, gewuenscht, (n) => (endName = n), verlaufZiel)
    }
    if (fehler) {
      if (kopie) await supabase.storage.from(kopie.eimer).remove([kopie.pfad]).catch(() => {})
      return `Fehler beim Speichern in ${ortTitel(ziel)}: ${fehler}. Nichts wurde verschoben.`
    }
  } else {
    meldungen.push(`Dieselbe Datei lag schon in ${ortTitel(ziel)} („${schonDa.name}“), dort nicht noch einmal abgelegt.`)
  }

  // 2) Aus der Quelle nehmen.
  const verlaufQuelle = `Per Telegram von ${mitarbeiter.name} in ${ortTitel(ziel).replace(/^der /, 'die ')} verschoben: „${dok.name}“${endName !== dok.name ? ` (dort „${endName}“)` : ''}`
  const quellFehler = quelle.art === 'kunde'
    ? await schreibeKunde(k, quelle.id, (doks) => (doks.some((d) => d?.id === dokId) ? doks.filter((d) => d?.id !== dokId) : null), verlaufQuelle)
    : await schreibeObjekt(k, quelle.id, (doks) => ohneDokument(doks, dokId), verlaufQuelle, [dokId])
  if (quellFehler) {
    meldungen.push(`Aus ${ortTitel(quelle)} ließ es sich nicht herausnehmen (${quellFehler}); es liegt jetzt an beiden Stellen.`)
  } else if (kopie) {
    const hinweis = await raeumeAltDateiAuf(k, altOrt, quelle.id)
    if (hinweis) meldungen.push(hinweis.trim())
  }
  protokolliere(`„${dok.name}“ von ${ortTitel(quelle)} nach ${ortTitel(ziel)} verschoben${endName !== dok.name ? ` (neuer Name „${endName}“)` : ''}`)
  return [`Verschoben: „${endName}“ liegt jetzt in ${ortTitel(ziel)}${zielOrdner ? ` (Ordner ${zielOrdner})` : ''} statt in ${ortTitel(quelle)}. dokument_id=${dokId}, ${idText(ziel)}`, ...meldungen].join('\n')
}

/** Neues Dokument oben in die Kundenakte; bei gleichem Namen „Name (2)“. */
function schreibeKundeMitName(k: DateiKontext, kundeId: string, neu: Dok, wunsch: string, merke: (n: string) => void, verlauf: (n: string) => string): Promise<string | null> {
  let endName = wunsch
  return schreibeKundeDynamisch(k, kundeId, (doks) => {
    const rest = doks.filter((d) => d?.id !== neu.id)
    endName = freierName(wunsch, rest.map((d) => ({ name: String(d?.name ?? '') })))
    merke(endName)
    return [{ ...neu, name: endName }, ...rest]
  }, () => verlauf(endName))
}

function schreibeObjektMitName(k: DateiKontext, objektId: string, ordner: string, neu: Dok, wunsch: string, merke: (n: string) => void, verlauf: (n: string) => string): Promise<string | null> {
  let endName = wunsch
  return schreibeObjektDynamisch(k, objektId, (doks) => {
    const liste = (Array.isArray(doks[ordner]) ? doks[ordner] : []).filter((d) => d?.id !== neu.id)
    endName = freierName(wunsch, liste.map((d) => ({ name: String(d?.name ?? '') })))
    merke(endName)
    return { ...doks, [ordner]: [{ ...neu, name: endName }, ...liste] }
  }, () => verlauf(endName))
}

/** Wie schreibeKunde, aber der Verlaufstext entsteht erst nach dem Ändern (der endgültige Name steht dann fest). */
async function schreibeKundeDynamisch(k: DateiKontext, kundeId: string, aendern: (doks: Dok[]) => Dok[] | null, verlauf: () => string): Promise<string | null> {
  const { data, error } = await k.supabase.from('kunden').select('dokumente, activities').eq('id', kundeId).maybeSingle()
  if (error || !data) return error?.message ?? 'Die Akte gibt es nicht mehr.'
  const neu = aendern(Array.isArray(data.dokumente) ? data.dokumente : [])
  if (!neu) return 'Das Dokument liegt nicht mehr in der Akte (inzwischen geändert). Lies die Akte neu.'
  const { error: e2 } = await k.supabase
    .from('kunden')
    .update({ dokumente: neu, activities: [verlaufEintrag(k, verlauf()), ...(Array.isArray(data.activities) ? data.activities : [])], letzte_aktivitaet: k.heute })
    .eq('id', kundeId)
  return e2 ? e2.message : null
}

async function schreibeObjektDynamisch(k: DateiKontext, objektId: string, aendern: (doks: Record<string, Dok[]>) => Record<string, Dok[]> | null, verlauf: () => string): Promise<string | null> {
  const { data, error } = await k.supabase.from('objekte').select('dokumente, activities').eq('id', objektId).maybeSingle()
  if (error || !data) return error?.message ?? 'Das Objekt gibt es nicht mehr.'
  const neu = aendern(objektListe(data.dokumente))
  if (!neu) return 'Das Dokument liegt nicht mehr in der Objektakte (inzwischen geändert). Lies die Akte neu.'
  const { error: e2 } = await k.supabase
    .from('objekte')
    .update({ dokumente: neu, activities: [verlaufEintrag(k, verlauf()), ...(Array.isArray(data.activities) ? data.activities : [])], updated_at: new Date().toISOString() })
    .eq('id', objektId)
  return e2 ? e2.message : null
}

// deno-lint-ignore no-explicit-any
async function dateiUmbenennen(input: any, k: DateiKontext): Promise<string> {
  const { protokolliere, mitarbeiter } = k
  const ort = await ladeOrt(k, input.kunde_id, input.objekt_id, 'das Dokument')
  if (typeof ort === 'string') return ort
  const fund = findeImOrt(ort, input.dokument_id, input.name)
  if (typeof fund === 'string') return fund
  const dok = fund.dok
  const dokId = String(dok.id ?? '')
  if (!dokId) return 'Fehler: Dieses Dokument hat keine Kennung und lässt sich hier nicht umbenennen. Bitte im CRM ändern.'
  const altName = String(dok.name ?? '')
  const wunsch = text(input.neuer_name) ? behalteEndung(input.neuer_name, altName) : altName
  const kategorie = text(input.kategorie ?? input.ordner)
  if (!wunsch) return 'Fehler: Der neue Name ist leer.'

  if (ort.art === 'objekt') {
    const altOrdner = fund.ordner ?? 'Sonstiges'
    const neuOrdner = kategorie ? ordnerVon(kategorie) : altOrdner
    if (!neuOrdner) return `Fehler: In der Objektakte ist die Art der Ordner. „${kategorie}“ gibt es nicht. Möglich: ${OBJEKT_ORDNER.join(', ')}.`
    if (wunsch === altName && neuOrdner === altOrdner) return `Nichts geändert: „${altName}“ heißt schon so und liegt schon im Ordner ${altOrdner}.`
    let endName = wunsch
    const fehler = await schreibeObjektDynamisch(k, ort.id, (doks) => {
      const ohne = ohneDokument(doks, dokId)
      if (!ohne) return null
      const alt = Object.values(doks).flatMap((l) => (Array.isArray(l) ? l : [])).find((d) => d?.id === dokId)!
      const liste = Array.isArray(ohne[neuOrdner]) ? ohne[neuOrdner] : []
      endName = wunsch === altName ? altName : freierName(wunsch, liste.map((d) => ({ name: String(d?.name ?? '') })))
      // Im selben Ordner bleibt die Stelle in der Liste erhalten.
      if (neuOrdner === altOrdner) return { ...doks, [altOrdner]: (doks[altOrdner] ?? []).map((d) => (d?.id === dokId ? { ...d, name: endName } : d)) }
      return { ...ohne, [neuOrdner]: [{ ...alt, name: endName }, ...liste] }
    }, () => `Dokument per Telegram von ${mitarbeiter.name} geändert: ${endName !== altName ? `„${altName}“ → „${endName}“` : `„${altName}“`}${neuOrdner !== altOrdner ? `; Ordner ${altOrdner} → ${neuOrdner}` : ''}`)
    if (fehler) return `Fehler beim Speichern: ${fehler}`
    const was = [endName !== altName ? `„${altName}“ heißt jetzt „${endName}“` : `„${altName}“`, neuOrdner !== altOrdner ? `liegt jetzt im Ordner ${neuOrdner} (vorher ${altOrdner})` : ''].filter(Boolean).join(' und ')
    protokolliere(`In ${ortTitel(ort)}: ${was}`)
    return `Geändert in ${ortTitel(ort)}: ${was}. dokument_id=${dokId}, ${idText(ort)}`
  }

  const altKategorie = text(dok.kategorie)
  if (wunsch === altName && (!kategorie || kategorie === altKategorie)) return `Nichts geändert: „${altName}“ heißt schon so.`
  let endName = wunsch
  const fehler = await schreibeKundeDynamisch(k, ort.id, (doks) => {
    if (!doks.some((d) => d?.id === dokId)) return null
    endName = wunsch === altName ? altName : freierName(wunsch, doks.filter((d) => d?.id !== dokId).map((d) => ({ name: String(d?.name ?? '') })))
    return doks.map((d) => (d?.id === dokId ? { ...d, name: endName, ...(kategorie ? { kategorie } : {}) } : d))
  }, () => `Dokument per Telegram von ${mitarbeiter.name} geändert: ${endName !== altName ? `„${altName}“ → „${endName}“` : `„${altName}“`}${kategorie && kategorie !== altKategorie ? `; Art: ${kategorie}` : ''}`)
  if (fehler) return `Fehler beim Speichern: ${fehler}`
  const was = [endName !== altName ? `„${altName}“ heißt jetzt „${endName}“` : `„${altName}“`, kategorie && kategorie !== altKategorie ? `Art: ${kategorie}` : ''].filter(Boolean).join(', ')
  protokolliere(`In ${ortTitel(ort)}: ${was}`)
  return `Geändert in ${ortTitel(ort)}: ${was}. dokument_id=${dokId}, ${idText(ort)}`
}

// deno-lint-ignore no-explicit-any
async function dateiLoeschen(input: any, k: DateiKontext): Promise<string> {
  const { protokolliere, mitarbeiter } = k
  const ort = await ladeOrt(k, input.kunde_id, input.objekt_id, 'das Dokument')
  if (typeof ort === 'string') return ort
  const fund = findeImOrt(ort, input.dokument_id, input.name)
  if (typeof fund === 'string') return fund
  const dok = fund.dok
  const dokId = String(dok.id ?? '')
  if (!dokId) return 'Fehler: Dieses Dokument hat keine Kennung und lässt sich hier nicht löschen. Bitte im CRM löschen.'
  const dateiOrt = dateiOrtVon(dok.url, ort.art === 'objekt')
  const plan = await planeAufbewahrung(k, dateiOrt, ort.id, { art: ort.art, id: ort.id, dokId })
  const angaben = [dok.datum, dok.groesse, fund.ordner ? `Ordner ${fund.ordner}` : ''].filter(Boolean).join(', ')

  if (input.bestaetigt !== true) {
    const datei = plan.art === 'aussortieren'
      ? 'Die Datei selbst wird nicht vernichtet, sondern unter „aussortiert“ aufbewahrt.'
      : plan.art === 'verwendet'
      ? 'Die Datei bleibt gespeichert, weil sie noch in einer anderen Akte liegt.'
      : plan.art === 'keine_datei'
      ? 'Zu dem Eintrag ist keine Datei hinterlegt.'
      : 'Die Datei selbst bleibt gespeichert (sie gehört nicht zum Ordner dieser Akte, z. B. ein Mail-Anhang).'
    return `NOCH NICHT GELÖSCHT. Frage den Mitarbeiter jetzt ausdrücklich, ob „${dok.name}“${angaben ? ` (${angaben})` : ''} aus ${ortTitel(ort)} gelöscht werden soll. ${datei} In den Verlauf der Akte kommt ein Vermerk. Nur wenn er in seiner nächsten Nachricht klar zustimmt, rufe datei_loeschen erneut mit bestaetigt=true und dokument_id=${dokId} (${idText(ort)}) auf.`
  }

  const verlauf = `Dokument per Telegram von ${mitarbeiter.name} gelöscht: „${dok.name}“${fund.ordner ? ` (Ordner ${fund.ordner})` : ''} ${PLAN_VERMERK[plan.art]}`
  const fehler = ort.art === 'kunde'
    ? await schreibeKunde(k, ort.id, (doks) => (doks.some((d) => d?.id === dokId) ? doks.filter((d) => d?.id !== dokId) : null), verlauf)
    : await schreibeObjekt(k, ort.id, (doks) => ohneDokument(doks, dokId), verlauf, [dokId])
  if (fehler) return `Fehler beim Speichern: ${fehler} Nichts wurde gelöscht.`
  const speicherFehler = await fuehrePlanAus(k, plan)
  protokolliere(`Dokument „${dok.name}“ aus ${ortTitel(ort)} gelöscht ${PLAN_VERMERK[plan.art]}`)
  const datei = plan.art === 'aussortieren'
    ? speicherFehler ? ` Die Datei ließ sich nicht nach „aussortiert“ verschieben (${speicherFehler}); sie liegt unverändert im Speicher.` : ' Die Datei ist unter „aussortiert“ aufbewahrt.'
    : plan.art === 'verwendet'
    ? ' Die Datei bleibt gespeichert, weil sie noch in einer anderen Akte liegt.'
    : plan.art === 'bleibt'
    ? ' Die Datei selbst bleibt unverändert gespeichert.'
    : ''
  return `Gelöscht: „${dok.name}“ aus ${ortTitel(ort)}, mit Vermerk im Verlauf.${datei}`
}

// deno-lint-ignore no-explicit-any
async function dateiAnKollegen(input: any, k: DateiKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere } = k
  const anName = text(input.an)
  if (!anName) return 'Fehler: an fehlt — an welchen Kollegen soll die Datei gehen?'
  const perTelegram = input.per_telegram !== false
  const perMail = input.per_mail === true
  if (!perTelegram && !perMail) return 'Fehler: Weder per Telegram noch per Mail gewählt.'
  const ort = await ladeOrt(k, input.kunde_id, input.objekt_id, 'das Dokument')
  if (typeof ort === 'string') return ort
  const fund = findeImOrt(ort, input.dokument_id, input.name)
  if (typeof fund === 'string') return fund
  const dok = fund.dok
  const name = String(dok.name ?? 'Datei')

  const gesucht = await findeKollege(supabase, anName)
  if ('meldung' in gesucht) return gesucht.meldung
  const kollege = gesucht.kollege
  const selbst = istEigene(mitarbeiter, kollege.email)
  // Rechte des Empfängers: er muss die Akte selbst sehen dürfen; Privates geht nie an andere.
  if (!selbst) {
    if (ort.art === 'kunde' && !darfAkte(kollege, ort.akte)) {
      return istPrivat(ort.akte) ? 'Nicht gesendet: Dateien aus privaten Akten gehen nicht an Kollegen.' : `Nicht gesendet: ${kollege.name} darf die Akte von ${akteTitel(ort.akte)} nicht sehen (der Bereich ${bereichName(ort.akte.bereich)} ist für ${kollege.name} nicht freigegeben).`
    }
    if (ort.art === 'objekt' && !darfObjekt(kollege, ort.objekt)) {
      return text(ort.objekt.privat_besitzer) ? 'Nicht gesendet: Dateien aus privaten Objekten gehen nicht an Kollegen.' : `Nicht gesendet: ${kollege.name} darf Objektakten nicht sehen (der Bereich Immobilien ist für ${kollege.name} nicht freigegeben).`
    }
  }

  const nachricht = text(input.nachricht).slice(0, 1000)
  const herkunft = ortTitel(ort)
  const gesendet: string[] = []
  const nicht: string[] = []

  if (perTelegram) {
    const sensibel = dok.quelle === 'assistent' ? null : sensibleArt([name])
    if (sensibel) {
      nicht.push(`Telegram: „${name}“ ist eine sensible Unterlage (${sensibel}) und geht aus Datenschutzgründen nicht über Telegram.${perMail ? '' : ' Per Mail an die Arbeitsadresse ginge es (per_mail=true).'}`)
    } else if (!kollege.telegram_chat_id) {
      nicht.push(`Telegram: ${kollege.name} ist nicht mit Telegram verbunden.${perMail ? '' : ' Per Mail an die Arbeitsadresse ginge es (per_mail=true).'}`)
    } else {
      const beschriftung = `Von ${mitarbeiter.name}${nachricht ? `: ${nachricht}` : ` — „${name}“ aus ${herkunft}`}`.slice(0, 1000)
      const r = await sendeDokumentAnChat({ supabase, botToken: k.botToken, abruf: k.abruf }, { ...dok, url: lesbarerVerweis(dok.url, ort.art === 'objekt') }, kollege.telegram_chat_id, beschriftung, kollege.name)
      if (!r.ok) nicht.push(`Telegram: ${r.meldung}`)
      else if (r.testlauf) gesendet.push(`Telegram (Testlauf ohne Bot-Schlüssel, nur protokolliert, ${r.groesse})`)
      else gesendet.push(`Telegram (${r.groesse})`)
    }
  }

  if (perMail) {
    const adresseKollege = text(kollege.email)
    if (!k.sendeMail) nicht.push('Mail: Der Mailversand ist hier nicht eingerichtet.')
    else if (!adresseKollege) nicht.push(`Mail: Für ${kollege.name} ist keine Arbeitsadresse hinterlegt.`)
    else {
      const geladen = await ladeDatei(supabase, dateiOrtVon(dok.url, ort.art === 'objekt'), MAIL_GRENZE)
      if (typeof geladen === 'string') nicht.push(`Mail: ${geladen}${geladen.includes('groß') ? ' Sie lässt sich im CRM in der Akte unter Dokumente öffnen.' : ''}`)
      else {
        const vorname = kollege.name.split(' ')[0] || kollege.name
        const r = await k.sendeMail({
          an: adresseKollege,
          anName: kollege.name,
          betreff: `Datei von ${mitarbeiter.name}: ${name}`,
          text: [`Hallo ${vorname},`, '', `${mitarbeiter.name} schickt dir „${name}“ aus ${herkunft}.`, ...(nachricht ? ['', nachricht] : []), '', 'Die Datei liegt auch im CRM in der Akte unter Dokumente.', '', 'Gesendet über den Assistenten des CRM'].join('\n'),
          anhaenge: [{ filename: name, contentType: String(dok.typ || geladen.typ || 'application/octet-stream'), contentBase64: bytesZuBase64(geladen.bytes) }],
        })
        if (r.ok) gesendet.push(`Mail an ${adresseKollege}`)
        else nicht.push(`Mail: ${r.fehler ?? 'Versand fehlgeschlagen.'}`)
      }
    }
  }

  if (gesendet.length) {
    const vermerk = `„${name}“ von ${mitarbeiter.name} über den Assistenten an ${kollege.name} geschickt (${gesendet.join(', ')})`
    // Weitergabe im Verlauf der Akte vermerken; ein Fehler hier macht den Versand nicht rückgängig.
    const fehler = ort.art === 'kunde' ? await schreibeKunde(k, ort.id, null, vermerk) : await schreibeObjekt(k, ort.id, null, vermerk)
    protokolliere(`„${name}“ aus ${herkunft} an ${kollege.name} geschickt (${gesendet.join(', ')})`)
    return [`Gesendet an ${kollege.name}: „${name}“ — ${gesendet.join(', ')}.`, ...nicht.map((n) => `Nicht gesendet: ${n}`), fehler ? `Der Vermerk im Verlauf ließ sich nicht speichern (${fehler}).` : ''].filter(Boolean).join('\n')
  }
  return ['Nicht gesendet.', ...nicht].join('\n')
}
