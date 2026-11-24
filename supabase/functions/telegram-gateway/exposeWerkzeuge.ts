// Assistent-Werkzeug „expose_erstellen“ (22.11.2026): fertiges Exposé eines Objekts als PDF, abgelegt in der
// Objektakte im Ordner „Exposé“, auf Wunsch gleich für das Interessenten-Portal freigegeben. Anlass: zwei
// Wünsche vom 20.11.2026 — ein erstelltes Exposé landete in einer Sammelakte statt in der Objektakte, und
// die Kontaktdaten des Vermittlers (von einer Visitenkarte) fehlten darin. Die Geschäftsführung fragt
// künftig z. B. „Mach mir ein Exposé für Remstal“.
//
// Inhalt wie das Exposé aus dem CRM (src/components/ExposePdf.tsx, src/lib/exposeDaten.ts):
//  - erlaubt: Objektart, Ort bzw. Adresse, Flächen, Baujahr, Zimmer/Einheiten, Stellplätze, Mieteinnahmen,
//    Kaufpreis (sonst „Preis auf Anfrage“), Beschreibung (gespeicherter Exposé-Text oder vom Assistenten
//    geschrieben), Bilder aus dem Ordner „Bilder“, Ansprechpartner, auf Wunsch Vermittler und Provision;
//  - nie: Eigentümer/Auftraggeber, interne Notizen und Verlauf, Kurzprüfung (auch nicht die dort notierte
//    Provision), Bewertung (Kaufpreisvorstellung, Zielverkaufspreis), Abrechnung, andere Unterlagen.
//  Die Adresse steht standardmäßig drin: Exposés gehen über das Interessenten-Portal erst nach Zustimmung
//  zu AGB und Provision hinaus. Für ein anonymes Exposé adresse_zeigen=false (dann nur der Ort).
//
// Bilder: über die Bildbearbeitung des Speichers verkleinert und zugeschnitten (gedreht nach der
// Ausrichtung des Fotos), damit das PDF auch mit sieben Handyfotos klein bleibt und die Rechenzeit der
// Edge-Funktion reicht. Geht das nicht, wird das Original genommen, wenn es nicht zu groß ist.
//
// Der Assistent arbeitet mit vollen Datenbankrechten; die Rechte prüft objektAblage.ts (rechte.ts).

import { exposeBilderAuswahl } from '../_shared/bilderReihenfolge.ts'
import { speicherOrt } from './dateiSenden.ts'
import { deDatum, FIRMA, heuteBerlin } from './dokumentErstellen.ts'
import { type ExposeBildDaten, type ExposeKontakt, erstelleExposePdf } from './exposePdf.ts'
import { type AblageKontext, gibFuerPortalFrei, ladeObjektMitRechten, legeInsObjektAb, objektAnzeige, type ObjektZeile } from './objektAblage.ts'
import type { ObjektDokument } from './objektakte.ts'
import { telefonFuerMitarbeiter } from '../_shared/profilKern.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type ExposeKontext = AblageKontext & {
  mitarbeiter: AblageKontext['mitarbeiter'] & { id?: string | null; email?: string | null }
  heute?: string
}

export const MAX_BILDER = 7
const MAX_ZEICHEN = 20_000
/** Original ohne Verkleinerung nur bis zu dieser Größe (JPEG) bzw. PNG bis 1,5 MB (PNG muss entpackt werden). */
const MAX_ORIGINAL_JPEG = 4 * 1024 * 1024
const MAX_ORIGINAL_PNG = 1.5 * 1024 * 1024
/** Obergrenze aller Bilder zusammen, damit das PDF als Anhang und im Portal handlich bleibt. */
const MAX_BILDER_BYTES = 12 * 1024 * 1024

const SPALTEN = 'id, bezeichnung, adresse, typ, kaufpreis, expose_text, verkaufsdaten, dokumente, bilder_reihenfolge, off_market, privat_besitzer, eigentuemer'

export const EXPOSE_WERKZEUGE = [
  {
    name: 'expose_erstellen',
    description:
      'Erstellt ein fertiges Exposé eines Immobilien-Objekts als PDF (Deckblatt mit Titelbild, Kaufpreis und Eckdaten, Beschreibung, bis zu sechs weitere Bilder aus dem Ordner „Bilder“, Ansprechpartner, Hinweis) und legt es in der Objektakte im Ordner „Exposé“ ab; auf Wunsch gleich für das Interessenten-Portal freigegeben. Verwenden bei „Mach mir ein Exposé für …“, „Exposé erstellen/neu machen“. Eigentümer, interne Notizen, Kurzprüfung und Bewertung kommen nie hinein. ' +
      'Vorher: objekt_id mit objekte_suchen ermitteln und das Objekt mit objektakte_lesen ansehen. Ist dort kein Exposé-Text hinterlegt oder fehlen Eckdaten (Flächen, Baujahr, Zimmer …), lies die Unterlagen des Objekts (z. B. das Exposé des Anbieters im Ordner „Exposé“ mit dokument_inhalt) und gib eine selbst geschriebene Beschreibung in beschreibung und die Zahlen in eckdaten mit — nichts erfinden, nur was in den Unterlagen steht. ' +
      'Ansprechpartner ist der Mitarbeiter selbst (Name, Telefon, E-Mail aus dem CRM), mit ansprechpartner ein Kollege. Nennt der Mitarbeiter einen Vermittler oder schickt eine Visitenkarte, dessen Angaben in vermittler (erscheint als eigener Kasten „Vermittler“). Danach in einer Zeile bestätigen, wie die Datei heißt und wo sie liegt.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Das Objekt (ID aus objekte_suchen).' },
        titel: { type: 'string', description: 'Optional: Titel auf dem Deckblatt, z. B. "Boarding House im Remstal". Ohne Angabe „Objektart in Ort“.' },
        beschreibung: { type: 'string', description: 'Optional: Beschreibungstext (ersetzt den am Objekt gespeicherten Exposé-Text). Einfache Auszeichnung: "## " Zwischenüberschrift, "- " Aufzählung, **fett**, Leerzeile zwischen Absätzen. Nur Deutsch, keine Namen von Eigentümern.' },
        zusatz_text: { type: 'string', description: 'Optional: zusätzlicher Absatz, der hinter die Beschreibung kommt (z. B. „Besichtigung nach Absprache“).' },
        eckdaten: {
          type: 'array',
          description: 'Optional: weitere oder abweichende Eckdaten, z. B. [{"bezeichnung":"Wohnfläche","wert":"640 m²"},{"bezeichnung":"Baujahr","wert":"1994"}]. Gleiche Bezeichnung ersetzt den Wert aus dem CRM.',
          items: { type: 'object', properties: { bezeichnung: { type: 'string' }, wert: { type: 'string' } }, required: ['bezeichnung', 'wert'] },
        },
        provision: { type: 'string', description: 'Optional: Käuferprovision, wie sie im Exposé stehen soll, z. B. "3,57 % inkl. MwSt.". Nur, wenn der Mitarbeiter sie nennt.' },
        adresse_zeigen: { type: 'boolean', description: 'Volle Adresse zeigen (Vorgabe ja). false = anonymes Exposé, nur der Ort.' },
        ansprechpartner: { type: 'string', description: 'Optional: Name eines Kollegen, der statt des Mitarbeiters als Ansprechpartner erscheint.' },
        ohne_ansprechpartner: { type: 'boolean', description: 'Optional: true = kein eigener Ansprechpartner, nur der Vermittler (nur wenn ausdrücklich gewünscht).' },
        vermittler: {
          type: 'object',
          description: 'Optional: Kontaktdaten eines Vermittlers (z. B. von einer Visitenkarte).',
          properties: { name: { type: 'string' }, firma: { type: 'string' }, telefon: { type: 'string' }, email: { type: 'string' } },
        },
        max_bilder: { type: 'number', description: `Optional: höchstens so viele Bilder aus dem Ordner „Bilder“ (Vorgabe ${MAX_BILDER}, das erste wird Titelbild; 0 = ohne Bilder).` },
        portal_freigeben: { type: 'boolean', description: 'Optional: true = das Exposé gleich für das Interessenten-Portal des Objekts freigeben.' },
      },
      required: ['objekt_id'],
    },
  },
]

const NAMEN = new Set(EXPOSE_WERKZEUGE.map((w) => w.name))
export function istExposeWerkzeug(name: string): boolean {
  return NAMEN.has(name)
}

// ---------- Daten des Exposés (wie src/lib/exposeDaten.ts) ----------

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert.replace(/\s+/g, ' ').trim() : typeof wert === 'number' && Number.isFinite(wert) ? String(wert) : ''
}

function positiv(wert: unknown): number {
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' && wert.trim() !== '' ? Number(wert) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n))} €`
}

/** „120“ → „120 m²“; Freitext („ca. 120 m²“) bleibt. */
function flaeche(wert: unknown): string {
  const t = text(wert)
  if (!t) return ''
  return /^\d+(?:[.,]\d+)?$/.test(t) ? `${t.replace('.', ',')} m²` : t
}

export function objektartVon(o: ObjektZeile): string {
  return text(o.verkaufsdaten?.uebersicht?.objektart) || text(o.typ) || 'Immobilie'
}

/** Nur der Ort, ohne Straße und Postleitzahl; leer, wenn er sich nicht sicher ablesen lässt. */
export function ortVon(o: ObjektZeile): string {
  const ohnePlz = (t: string) => t.replace(/\b\d{5}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  const plzOrt = text(o.verkaufsdaten?.uebersicht?.plzOrt)
  if (plzOrt) return ohnePlz(plzOrt)
  const adresse = text(o.adresse)
  if (!adresse) return ''
  const teile = adresse.split(',').map((t) => t.trim()).filter(Boolean)
  if (teile.length > 1) {
    const ort = ohnePlz(teile[teile.length - 1])
    return /\d/.test(ort) ? '' : ort
  }
  const mitPlz = adresse.match(/\b\d{5}\s+([^\d,]+)$/)
  if (mitPlz) return mitPlz[1].trim()
  return /\d/.test(adresse) ? '' : adresse
}

export function adresseVon(o: ObjektZeile): string {
  const u = o.verkaufsdaten?.uebersicht
  return [text(u?.strasse), text(u?.plzOrt)].filter(Boolean).join(', ') || text(o.adresse)
}

export function preisText(o: ObjektZeile): string {
  const p = positiv(o.kaufpreis)
  return p > 0 ? euro(p) : 'Preis auf Anfrage'
}

export type Fakt = { label: string; wert: string }

/** Eckdaten aus dem Verkaufsdatenblatt, dazu die vom Assistenten genannten (gleiche Bezeichnung ersetzt) und die Provision. Kaufpreis immer zuletzt. */
export function exposeFakten(o: ObjektZeile, zusatz: Fakt[] = [], provision = ''): Fakt[] {
  const k = o.verkaufsdaten?.kennzahlen ?? {}
  const miete = positiv(k.jahresnettokaltmiete)
  const preis = positiv(o.kaufpreis)
  const fakten: Fakt[] = [
    { label: 'Objektart', wert: objektartVon(o) },
    { label: 'Wohnfläche', wert: flaeche(k.wohnflaeche) },
    { label: 'Nutzfläche', wert: flaeche(k.nutzflaeche) },
    { label: 'Grundstück', wert: flaeche(k.grundstuecksflaeche) },
    { label: 'Baujahr', wert: text(k.baujahr) },
    { label: 'Zimmer', wert: text(k.zimmer) },
    { label: 'Einheiten', wert: text(k.einheiten) },
    { label: 'Stellplätze', wert: text(k.stellplaetze) },
    { label: 'Mieteinnahmen im Jahr (netto kalt)', wert: miete > 0 ? euro(miete) : '' },
  ]
  if (miete > 0 && preis > 0) fakten.push({ label: 'Kaufpreis-Faktor', wert: `${(preis / miete).toFixed(1).replace('.', ',').replace(/,0$/, '')}-fach` })
  const schluessel = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, '')
  for (const z of zusatz) {
    const label = text(z.label)
    const wert = text(z.wert)
    if (!label || !wert || schluessel(label) === 'kaufpreis') continue
    const i = fakten.findIndex((f) => schluessel(f.label) === schluessel(label))
    if (i >= 0) fakten[i] = { label: fakten[i].label, wert }
    else fakten.push({ label, wert })
  }
  if (text(provision)) fakten.push({ label: 'Käuferprovision', wert: text(provision) })
  fakten.push({ label: 'Kaufpreis', wert: preisText(o) })
  return fakten.filter((f) => f.wert !== '').slice(0, 20)
}

export function standardTitel(o: ObjektZeile, ort: string): string {
  const art = objektartVon(o)
  return ort ? `${art} in ${ort}` : art
}

/** Namen von Eigentümer/Auftraggeber (und ohne Adresse: die Straße), die im Text stehen. */
export function interneAngabenIn(o: ObjektZeile, inhalt: string, adresseErlaubt: boolean): string[] {
  const t = inhalt.toLowerCase()
  const gefunden = new Set<string>()
  const namen = [o.eigentuemer?.name, o.eigentuemer?.ansprechpartner, o.verkaufsdaten?.auftraggeber?.name].map(text).filter((n) => n.length >= 4)
  for (const n of namen) {
    if (t.includes(n.toLowerCase())) gefunden.add(`Name des Eigentümers („${n}“)`)
    const nachname = n.split(/\s+/).pop() ?? ''
    if (nachname.length >= 4 && nachname !== n && new RegExp(`\\b${nachname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(inhalt)) gefunden.add(`Name des Eigentümers („${nachname}“)`)
  }
  if (!adresseErlaubt) {
    const adr = text(o.adresse)
    const strassen = [text(o.verkaufsdaten?.uebersicht?.strasse), adr.includes(',') || /\d/.test(adr) ? adr.split(',')[0].trim() : '']
    for (const s of strassen) {
      if (!s || !/\d|str\.|straße|strasse|weg|gasse|platz|allee|ring/i.test(s)) continue
      const ohneNummer = s.replace(/\s*\d+\s*[a-z]?(?:\s*[-–/]\s*\d+\s*[a-z]?)?$/i, '').trim()
      if (ohneNummer.length >= 4 && t.includes(ohneNummer.toLowerCase())) gefunden.add(`Straße („${ohneNummer}“)`)
    }
  }
  return [...gefunden]
}

const BILD_ENDUNG = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i
export function istBild(d: { typ?: string; name?: string; url?: string }): boolean {
  return !!d.url && (String(d.typ ?? '').toLowerCase().startsWith('image/') || BILD_ENDUNG.test(String(d.name ?? '')) || BILD_ENDUNG.test(String(d.url ?? '')))
}

// ---------- Bilder und Logo laden ----------

/** Speicherort einer Datei der Objektakte: schlichter Pfad = Eimer „objekt-dokumente“ (wie objektDateiUrl im CRM), Adressen des eigenen Speichers wie dateiSenden.ts. */
export function objektSpeicherOrt(url: string): { eimer: string; pfad: string } | null {
  const u = String(url ?? '').trim()
  if (!u) return null
  return /^https?:\/\//i.test(u) || /^[a-z-]+:/i.test(u) ? speicherOrt(u) : speicherOrt(`objekt-dokumente:${u}`)
}

type Masse = { width: number; height: number }
const TITEL: Masse = { width: 1600, height: 1067 }
const GALERIE: Masse = { width: 1000, height: 750 }

function istJpegOderPng(b: Uint8Array): 'jpeg' | 'png' | null {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  return null
}

/** Verkleinert über die Bildbearbeitung des Speichers; sonst das Original, wenn es JPEG/PNG und nicht zu groß ist. */
async function ladeBild(supabase: Supa, eimer: string, pfad: string, masse: Masse, resize: 'cover' | 'contain'): Promise<ExposeBildDaten | null> {
  try {
    const { data, error } = await supabase.storage.from(eimer).download(pfad, { transform: { ...masse, resize, quality: 75, format: 'origin' } })
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (istJpegOderPng(bytes)) return { bytes }
    }
  } catch {
    // weiter mit dem Original
  }
  try {
    const { data, error } = await supabase.storage.from(eimer).download(pfad)
    if (error || !data) return null
    const bytes = new Uint8Array(await data.arrayBuffer())
    const art = istJpegOderPng(bytes)
    if (art === 'jpeg' && bytes.length <= MAX_ORIGINAL_JPEG) return { bytes }
    if (art === 'png' && bytes.length <= MAX_ORIGINAL_PNG) return { bytes }
  } catch {
    // ohne dieses Bild
  }
  return null
}

/** Logo aus den Vorlagen der Immobilienabteilung (Datei-Vorlage mit „Logo“ im Namen, ein Bild) — wie findeLogoVorlage im CRM. */
async function ladeLogo(supabase: Supa): Promise<ExposeBildDaten | undefined> {
  try {
    const { data } = await supabase.from('vorlagen').select('id, name, datei').eq('bereich', 'immobilien')
    const bild = (v: { datei?: { typ?: string; name?: string } | null }) => !!v.datei && (String(v.datei.typ ?? '').toLowerCase().startsWith('image/') || /\.(png|jpe?g)$/i.test(String(v.datei.name ?? '')))
    const kandidaten = ((data ?? []) as { name?: string; datei?: { typ?: string; name?: string; pfad?: string } | null }[]).filter(
      (v) => bild(v) && /logo/i.test(`${v.name ?? ''} ${v.datei?.name ?? ''}`) && !!v.datei?.pfad,
    )
    const pfad = kandidaten[0]?.datei?.pfad
    if (!pfad) return undefined
    const ort = speicherOrt(pfad)
    if (!ort) return undefined
    return (await ladeBild(supabase, ort.eimer, ort.pfad, { width: 600, height: 600 }, 'contain')) ?? undefined
  } catch {
    return undefined
  }
}

/** Firmenname aus dem Briefkopf (Vorlage „briefkopf“), sonst der feste Name. */
async function ladeFirma(supabase: Supa): Promise<string> {
  try {
    const { data } = await supabase.from('vorlagen').select('text').eq('id', 'briefkopf').maybeSingle()
    const name = data?.text ? JSON.parse(data.text)?.name : ''
    return typeof name === 'string' && name.trim() ? name.trim() : FIRMA
  } catch {
    return FIRMA
  }
}

type MitarbeiterKontakt = { name: string; email: string | null; telefon: string | null }

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()
}

async function ladeKontakt(supabase: Supa, m: ExposeKontext['mitarbeiter'], kollege: string): Promise<MitarbeiterKontakt | string> {
  if (kollege) {
    const { data } = await supabase.from('mitarbeiter').select('name, email, telefon').eq('aktiv', true)
    const alle = (data ?? []) as MitarbeiterKontakt[]
    const s = norm(kollege)
    const treffer = alle.find((x) => norm(x.name) === s) ?? alle.filter((x) => norm(x.name).split(/\s+/).includes(s)).at(0) ?? alle.find((x) => norm(x.name).includes(s))
    return treffer ?? `Fehler: Einen aktiven Mitarbeiter „${kollege}“ gibt es nicht. Ohne ansprechpartner erscheint ${m.name} selbst.`
  }
  if (m.id) {
    const { data } = await supabase.from('mitarbeiter').select('name, email, telefon').eq('id', m.id).maybeSingle()
    if (data) return data as MitarbeiterKontakt
  }
  return { name: m.name, email: m.email ?? null, telefon: null }
}

// ---------- Werkzeug ----------

// deno-lint-ignore no-explicit-any
export async function fuehreExposeWerkzeugAus(name: string, input: any, k: ExposeKontext): Promise<string> {
  if (name !== 'expose_erstellen') return `Fehler: unbekanntes Werkzeug ${name}.`
  try {
    return await exposeErstellen(input ?? {}, k)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}

// deno-lint-ignore no-explicit-any
async function exposeErstellen(input: any, k: ExposeKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere } = k
  const heute = k.heute ?? heuteBerlin()
  const beschreibungEingabe = String(input.beschreibung ?? '').replace(/\r\n?/g, '\n').trim()
  const zusatzText = String(input.zusatz_text ?? '').replace(/\r\n?/g, '\n').trim()
  if (beschreibungEingabe.length + zusatzText.length > MAX_ZEICHEN) return `Fehler: Beschreibung und Zusatztext sind zu lang (höchstens ${MAX_ZEICHEN} Zeichen). Bitte kürzen.`

  const o = await ladeObjektMitRechten(k, input.objekt_id, SPALTEN)
  if (typeof o === 'string') return o
  const privat = !!String(o.privat_besitzer ?? '').trim()

  // Kontakte: der Mitarbeiter (oder ein Kollege) und auf Wunsch der Vermittler.
  const kontakte: ExposeKontakt[] = []
  const ohneAnsprechpartner = input.ohne_ansprechpartner === true
  const v = input.vermittler && typeof input.vermittler === 'object' ? input.vermittler : typeof input.vermittler === 'string' ? { name: input.vermittler } : null
  const vermittler = v ? { name: text(v.name), firma: text(v.firma), telefon: text(v.telefon), email: text(v.email) } : null
  const mitVermittler = !!vermittler && !!(vermittler.name || vermittler.firma)
  if (ohneAnsprechpartner && !mitVermittler) return 'Fehler: Ohne Ansprechpartner braucht das Exposé einen Vermittler mit Name oder Firma.'
  const firma = privat ? mitarbeiter.name : await ladeFirma(supabase)
  if (!ohneAnsprechpartner) {
    const kontakt = await ladeKontakt(supabase, mitarbeiter, text(input.ansprechpartner))
    if (typeof kontakt === 'string') return kontakt
    const telefon = privat ? (kontakt.telefon ?? '') : await telefonFuerMitarbeiter(supabase, { name: kontakt.name, email: kontakt.email, telefon: kontakt.telefon }, { fuerExpose: true })
    kontakte.push({ titel: 'Ihr Ansprechpartner', name: kontakt.name, telefon, email: kontakt.email ?? '', firma })
  }
  if (mitVermittler) kontakte.push({ titel: 'Vermittler', ...vermittler! })

  // Inhalt.
  const adresseZeigen = input.adresse_zeigen !== false
  const ort = ortVon(o)
  const titel = text(input.titel) || standardTitel(o, ort)
  const beschreibung = [beschreibungEingabe || String(o.expose_text ?? '').trim(), zusatzText].filter(Boolean).join('\n\n')
  // deno-lint-ignore no-explicit-any
  const eckdaten: Fakt[] = (Array.isArray(input.eckdaten) ? input.eckdaten : []).map((e: any) => ({ label: text(e?.bezeichnung ?? e?.label), wert: text(e?.wert) }))
  const fakten = exposeFakten(o, eckdaten, text(input.provision))
  const warnungen = interneAngabenIn(o, [titel, beschreibung, ...eckdaten.map((e) => e.wert)].join('\n'), adresseZeigen)

  // Bilder aus dem Ordner „Bilder“ in der festgelegten Reihenfolge (objekte.bilder_reihenfolge, _shared/bilderReihenfolge.ts):
  // das erste wird Titelbild, „nicht im Exposé“ bleibt draußen, die eingestellte Drehung kommt dazu.
  const anzahl = Number.isFinite(Number(input.max_bilder)) ? Math.max(0, Math.min(MAX_BILDER, Math.floor(Number(input.max_bilder)))) : MAX_BILDER
  const imOrdner = ((o.dokumente?.Bilder ?? []) as ObjektDokument[]).filter(istBild)
  const auswahl = exposeBilderAuswahl(imOrdner, o.bilder_reihenfolge, anzahl)
  const gewaehlt = auswahl.map((a) => a.dok)
  const geladen: (ExposeBildDaten | null)[] = []
  let summe = 0
  for (let i = 0; i < gewaehlt.length; i++) {
    const ort = objektSpeicherOrt(gewaehlt[i].url)
    const drehung = auswahl[i].drehung
    // Hochkant gedreht: hochkant zuschneiden lassen, damit das Foto nach dem Drehen das Feld füllt.
    const masse = i === 0 ? TITEL : GALERIE
    const zuschnitt = drehung === 90 || drehung === 270 ? { width: masse.height, height: masse.width } : masse
    const bild = ort ? await ladeBild(supabase, ort.eimer, ort.pfad, zuschnitt, 'cover') : null
    if (bild && summe + bild.bytes.length > MAX_BILDER_BYTES) {
      geladen.push(null)
      continue
    }
    if (bild) summe += bild.bytes.length
    geladen.push(bild ? { ...bild, drehung } : null)
  }
  const nichtGeladen = gewaehlt.filter((_, i) => !geladen[i]).map((d) => d.name)
  const logo = privat ? undefined : await ladeLogo(supabase)

  const pdf = await erstelleExposePdf({
    titel,
    ortZeile: adresseZeigen ? adresseVon(o) || ort : ort,
    objektart: objektartVon(o),
    preisText: preisText(o),
    fakten,
    beschreibung,
    titelbild: geladen[0] ?? undefined,
    bilder: geladen.slice(1).filter((b): b is ExposeBildDaten => !!b),
    logo,
    firma,
    kontakte,
    vertraulich: o.off_market === true,
    stand: deDatum(heute),
  })

  const objektName = objektAnzeige(o)
  const abgelegt = await legeInsObjektAb(k, o, heute, {
    bytes: pdf.bytes,
    dateiName: `Exposé ${titel.replace(/[\\/:*?"<>|]/g, '-')} (${deDatum(heute)}).pdf`,
    typ: 'application/pdf',
    ordner: 'Exposé',
    aktivitaet: (n, g) => `Exposé „${n}“ (PDF, ${pdf.seiten} Seiten, ${g}) vom Assistenten für ${mitarbeiter.name} erstellt und im Ordner Exposé abgelegt.`,
  })
  if (typeof abgelegt === 'string') return abgelegt
  protokolliere(`Exposé „${abgelegt.name}“ erstellt und in der Objektakte ${objektName} (Ordner Exposé) abgelegt`)

  const zeilen = [
    `Exposé erstellt und in der Objektakte ${objektName} im Ordner Exposé abgelegt: „${abgelegt.name}“ (PDF, ${pdf.seiten} ${pdf.seiten === 1 ? 'Seite' : 'Seiten'}, ${abgelegt.groesse}, ${pdf.bilderImPdf === 0 ? 'ohne Bilder' : `${pdf.bilderImPdf} ${pdf.bilderImPdf === 1 ? 'Bild' : 'Bilder'}`}). Im CRM öffnet man es dort unter Unterlagen.`,
    `Ansprechpartner: ${kontakte.map((x) => `${x.titel} ${x.name || x.firma}`).join(', ')}. ${adresseZeigen ? 'Mit voller Adresse.' : `Ohne Straße, nur Ort${ort ? ` (${ort})` : ''}.`}`,
  ]
  if (input.portal_freigeben === true) {
    const frei = await gibFuerPortalFrei(k, o.id, abgelegt.id)
    if (frei === true) {
      protokolliere(`Exposé „${abgelegt.name}“ für das Interessenten-Portal freigegeben`)
      zeilen.push('Für das Interessenten-Portal freigegeben.')
    } else zeilen.push(frei)
  }
  if (!beschreibung) zeilen.push('Ohne Beschreibung: Am Objekt ist kein Exposé-Text hinterlegt. Für eine neue Fassung den Text aus den Unterlagen schreiben und in beschreibung mitgeben.')
  if (imOrdner.length === 0 && anzahl > 0) zeilen.push('Ohne Bilder: Im Ordner „Bilder“ der Objektakte liegen keine Fotos.')
  if (nichtGeladen.length) zeilen.push(`Nicht ins Exposé gekommen (Format oder Größe): ${nichtGeladen.join(', ')}.`)
  if (warnungen.length) zeilen.push(`Achtung, im Text steht: ${warnungen.join(', ')}. Bitte prüfen; für ein Exposé ohne diese Angaben neu erstellen.`)
  zeilen.push(`objekt_id=${o.id}, dokument_id=${abgelegt.id}`)
  return zeilen.join('\n')
}
