// Assistent-Werkzeug "dokument_erstellen": macht aus einem Text, den der Assistent geschrieben hat
// (Merkblatt, Schreiben, Zusammenfassung), eine fertige PDF-Datei und legt sie in der Kundenakte ab.
// Anlass: Andreas Mayer bat am 19.11.2026 zweimal um "ein Handout aus den Vertragsnotizen"; der
// Assistent konnte bis dahin nur Text zum Abschreiben liefern.
//
// Ablage wie beim Hochladen im CRM (src/lib/kundenDokumenteStorage.ts, DokumenteSection.tsx):
// privater Bucket "kunden-dokumente", Pfad "<kundeId>/dok_<kennung>_<dateiname>.pdf", und in
// kunden.dokumente ein Eintrag { id, name, typ, datum, groesse, url } mit url = Storage-Pfad (kein
// https). Geöffnet wird die Datei im CRM über einen kurz gültigen Link; email-gateway liest solche
// Pfade ebenfalls (dokument_inhalte), d. h. kundenakte_lesen und dokument_inhalt funktionieren auch.
//
// Die Datei kennt index.ts nicht (kein Kreis-Import): Datenbank, Mitarbeiter und Protokoll reicht der
// Aufrufer herein, die Rechte kommen aus rechte.ts.

import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { type AkteFuerRechte, darfAkte as darfAkteStandard, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type DokumentKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  /** Heutiges Datum JJJJ-MM-TT (Berlin). Ohne Angabe selbst ermittelt. */
  heute?: string
  /** Nur falls index.ts eine eigene Prüfung hat; sonst gilt darfAkte aus rechte.ts. */
  darfAkte?: (m: RechteMitarbeiter, akte: AkteFuerRechte) => boolean
}

const BUCKET = 'kunden-dokumente'
const MAX_ZEICHEN = 60_000

const ARTEN = ['handout', 'brief', 'zusammenfassung'] as const
type Art = (typeof ARTEN)[number]
// Angezeigt wird nur Deutsch: "handout" ist bloß der Schlüssel, auf dem Blatt steht "Merkblatt".
const ART_NAME: Record<Art, string> = { handout: 'Merkblatt', brief: 'Schreiben', zusammenfassung: 'Zusammenfassung' }

const FIRMA = 'Andreas Mayer Holding'
const FIRMA_ZEILE = 'Andreas Mayer Holding UG (haftungsbeschränkt) · Schwabstraße 3 · 89075 Ulm'

export const DOKUMENT_WERKZEUGE = [
  {
    name: 'dokument_erstellen',
    description:
      'Erstellt aus einem von dir geschriebenen Text eine fertige PDF-Datei (Merkblatt, Schreiben oder Zusammenfassung) mit Briefkopf der Andreas Mayer Holding, Datum und Seitenzahlen und legt sie als Dokument in der Kundenakte ab. Verwenden, wenn jemand ein Merkblatt, ein Schreiben oder eine Zusammenfassung "als Datei", "als PDF" oder "zum Ausdrucken/Mitgeben" möchte. Den Inhalt (z. B. aus Gesprächsprotokollen, Vertragsnotizen oder Dokumenten der Akte) schreibst du vorher selbst vollständig aus. Für eigene Unterlagen des Hauses ohne Kundenbezug kunde_id=k_intern_holding.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte, in der die Datei abgelegt wird.' },
        titel: { type: 'string', description: 'Überschrift des Dokuments auf Deutsch, z. B. "Merkblatt Erbvertrag". Wird auch Dateiname.' },
        inhalt: {
          type: 'string',
          description:
            'Der vollständige Text in einfacher Auszeichnung: "## " für Zwischenüberschriften ("### " für kleinere), "- " für Aufzählungspunkte (zwei Leerzeichen davor für eine Ebene tiefer), "1. " für nummerierte Punkte, **fett**, Leerzeile zwischen Absätzen, einzelner Zeilenumbruch bleibt erhalten (z. B. Anschrift, Grußformel), "---" für eine Trennlinie, einfache Tabellen mit "| a | b |". Den Titel nicht noch einmal als Überschrift wiederholen. Alles auf Deutsch.',
        },
        art: { type: 'string', enum: [...ARTEN], description: 'handout = Merkblatt (Vorgabe), brief = Schreiben, zusammenfassung = Zusammenfassung.' },
      },
      required: ['kunde_id', 'titel', 'inhalt'],
    },
  },
]

export function istDokumentWerkzeug(name: string): boolean {
  return name === 'dokument_erstellen'
}

// deno-lint-ignore no-explicit-any
export async function fuehreDokumentWerkzeugAus(name: string, input: any, k: DokumentKontext): Promise<string> {
  if (name !== 'dokument_erstellen') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere } = k
  const darf = k.darfAkte ?? darfAkteStandard
  const heute = k.heute ?? heuteBerlin()

  const kundeId = String(input?.kunde_id ?? '').trim()
  const titel = String(input?.titel ?? '').replace(/\s+/g, ' ').trim()
  const inhalt = String(input?.inhalt ?? '').replace(/\r\n?/g, '\n').trim()
  const art: Art = ARTEN.includes(input?.art) ? input.art : 'handout'
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
  if (!titel) return 'Fehler: titel fehlt.'
  if (!inhalt) return 'Fehler: inhalt ist leer. Schreib den vollständigen Text des Dokuments in inhalt.'
  if (inhalt.length > MAX_ZEICHEN) return `Fehler: inhalt ist zu lang (${inhalt.length} Zeichen, höchstens ${MAX_ZEICHEN}). Kürze den Text oder teile ihn auf mehrere Dokumente auf.`

  // Private Kontakte nur für ihren Besitzer (darfAkte); den eines Kollegen gibt es für den Mitarbeiter nicht.
  const { data: akte, error: ladeFehler } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (ladeFehler) return `Fehler beim Laden der Akte: ${ladeFehler.message}`
  const keinKunde = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'
  if (!akte) return keinKunde
  if (!darf(mitarbeiter, akte)) return istPrivat(akte) ? keinKunde : nichtFreigegeben(akte.bereich, mitarbeiter.name)
  const akteName = kundeName(akte)

  let pdf: { bytes: Uint8Array; seiten: number }
  try {
    pdf = await erstellePdf({ titel, inhalt, art, fuer: SAMMELAKTEN.includes(akte.id) ? undefined : akteName, datum: heute })
  } catch (e) {
    return `Fehler beim Erstellen der PDF: ${e instanceof Error ? e.message : String(e)}`
  }

  const dateiName = `${ohneEndung(titel)} (${deDatum(heute)}).pdf`
  const kennung = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const pfad = `${akte.id}/${kennung}_${sicheresPfadsegment(dateiName)}`
  const { error: hochFehler } = await supabase.storage.from(BUCKET).upload(pfad, pdf.bytes, { contentType: 'application/pdf', upsert: false })
  if (hochFehler) return `Fehler beim Speichern der PDF: ${hochFehler.message}. Nichts wurde abgelegt.`

  // Erst jetzt frisch lesen und gleich schreiben: Das Erstellen dauert, in der Zwischenzeit kann
  // jemand anderes Dokumente oder Einträge hinzugefügt haben.
  const { data: frisch, error: frischFehler } = await supabase.from('kunden').select('dokumente, activities').eq('id', akte.id).maybeSingle()
  if (frischFehler || !frisch) {
    await supabase.storage.from(BUCKET).remove([pfad]).catch(() => {})
    return `Fehler beim Speichern in der Akte: ${frischFehler?.message ?? 'Akte nicht mehr vorhanden'}. Nichts wurde abgelegt.`
  }
  const dokumente: { id: string; name: string }[] = Array.isArray(frisch.dokumente) ? frisch.dokumente : []
  const anzeigeName = freierName(dateiName, dokumente.map((d) => d.name))
  const neu = { id: kennung, name: anzeigeName, typ: 'application/pdf', datum: heute, groesse: formatGroesse(pdf.bytes.length), url: pfad }
  const eintrag = {
    id: crypto.randomUUID(),
    date: heute,
    text: `${ART_NAME[art]} als PDF „${anzeigeName}" (${pdf.seiten} ${pdf.seiten === 1 ? 'Seite' : 'Seiten'}) vom Assistenten für ${mitarbeiter.name} erstellt und unter Dokumente abgelegt.`,
    user: mitarbeiter.name,
  }
  const { error: schreibFehler } = await supabase
    .from('kunden')
    .update({ dokumente: [neu, ...dokumente], activities: [eintrag, ...(Array.isArray(frisch.activities) ? frisch.activities : [])], letzte_aktivitaet: heute })
    .eq('id', akte.id)
  if (schreibFehler) {
    await supabase.storage.from(BUCKET).remove([pfad]).catch(() => {})
    return `Fehler beim Speichern in der Akte: ${schreibFehler.message}. Nichts wurde abgelegt.`
  }
  protokolliere(`${ART_NAME[art]} „${anzeigeName}" erstellt und bei ${akteName} abgelegt`)
  return `Erstellt und abgelegt: „${anzeigeName}" (PDF, ${pdf.seiten} ${pdf.seiten === 1 ? 'Seite' : 'Seiten'}, ${neu.groesse}) in der Akte von ${akteName} unter Dokumente. Im CRM öffnet man es dort mit einem Klick. dokument_id=${kennung}`
}

// ---------- Hilfen ----------

function heuteBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}

function deDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
function langesDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[3])}. ${MONATE[Number(m[2]) - 1]} ${m[1]}` : iso
}

function kundeName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  const firma = String(k.firma ?? '').trim()
  const ap = String(k.ansprechpartner ?? '').trim()
  return ap && ap !== firma ? `${firma} (${ap})` : firma || ap
}

function formatGroesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ohneEndung(s: string): string {
  return s.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim()
}

// Storage-Schlüssel nur aus einfachen Zeichen; Umlaute werden ausgeschrieben.
function sicheresPfadsegment(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120)
}

function freierName(name: string, vorhanden: string[]): string {
  const belegt = new Set(vorhanden.map((n) => String(n).toLowerCase()))
  if (!belegt.has(name.toLowerCase())) return name
  for (let i = 2; i < 100; i++) {
    const kandidat = name.replace(/(\.pdf)$/i, ` (${i})$1`)
    if (!belegt.has(kandidat.toLowerCase())) return kandidat
  }
  return name
}

// ---------- PDF ----------

const A4 = { breite: 595.28, hoehe: 841.89 }
const RAND = { links: 64, rechts: 64, oben: 56, unten: 64 }
const TEXT_FARBE = rgb(0.13, 0.13, 0.13)
const GRAU = rgb(0.42, 0.42, 0.42)
const LINIE = rgb(0.78, 0.78, 0.78)
const AKZENT = rgb(0.13, 0.27, 0.42)
const TABELLEN_KOPF = rgb(0.95, 0.95, 0.95)

const GROESSE = 10.5
const ZEILE = 15

type Schriften = { normal: PDFFont; fett: PDFFont; kursiv: PDFFont; fettKursiv: PDFFont; symbol: PDFFont }

// Haken, Kreuze und ein paar Zeichen, die Helvetica nicht hat, kommen aus der Symbolschrift
// ZapfDingbats (ebenfalls eine Standardschrift, nichts wird eingebettet).
const SYMBOLE = new Set(['✓', '✔', '✗', '✘', '★', '☎', '✉', '➔'])

function symbolTeile(text: string, font: PDFFont, f: Schriften): Teil[] {
  const aus: Teil[] = []
  for (const z of text) {
    const fz = SYMBOLE.has(z) ? f.symbol : font
    const letzter = aus[aus.length - 1]
    if (letzter && letzter.font === fz) letzter.text += z
    else aus.push({ text: z, font: fz })
  }
  return aus
}
type Teil = { text: string; font: PDFFont }
type Wort = { teile: Teil[]; leerDavor: boolean }
type Zeile = { teile: Teil[]; breite: number }
type Lauf = { text: string; fett: boolean; kursiv: boolean }

// Was die Standardschrift (WinAnsi) nicht kennt, wird ersetzt statt die Erstellung abzubrechen.
const ERSATZ: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '', '\t': '    ',
  '‐': '-', '‑': '-', '‒': '-', '−': '-', '―': '—',
  '′': "'", '″': '"', '‟': '"', '‛': "'",
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '➔': '->', '➜': '->', '▶': '>', '►': '>',
  '≥': '>=', '≤': '<=', '≈': '~', '≠': 'ungleich', '∞': 'unbegrenzt', '√': 'Wurzel',
  '☑': '✔', '☒': '✘', '☐': '-', '◦': '·', '▪': '•', '■': '•', '●': '•', '○': '·', '◆': '•',
  '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
}

function zeichenFilter(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  return (s: string) => {
    let aus = ''
    for (const z of s) {
      const cp = z.codePointAt(0)!
      if (cp === 10 || erlaubt.has(cp) || SYMBOLE.has(z)) {
        aus += z
        continue
      }
      if (z in ERSATZ) {
        aus += ERSATZ[z]
        continue
      }
      // Akzente abwerfen (é → e), wenn der Grundbuchstabe darstellbar ist; sonst weglassen
      // (Sinnbilder wie Emojis) bzw. "?" für unbekannte Buchstaben.
      const basis = z.normalize('NFD').replace(/[̀-ͯ]/g, '')
      if (basis && [...basis].every((b) => erlaubt.has(b.codePointAt(0)!))) aus += basis
      else if (/\p{L}|\p{N}/u.test(z)) aus += '?'
    }
    return aus
  }
}

/** Inline-Auszeichnung: **fett**, __fett__, *kursiv*, `Code` (nur Text), [Text](Adresse). */
function laeufe(s: string, basis: { fett: boolean; kursiv: boolean } = { fett: false, kursiv: false }): Lauf[] {
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)').replace(/`([^`]+)`/g, '$1')
  const aus: Lauf[] = []
  const muster = /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g
  let pos = 0
  for (const m of s.matchAll(muster)) {
    if (m.index! > pos) aus.push({ text: s.slice(pos, m.index), ...basis })
    if (m[1] !== undefined || m[2] !== undefined) aus.push(...laeufe(m[1] ?? m[2], { ...basis, fett: true }))
    else aus.push({ text: m[3], fett: basis.fett, kursiv: true })
    pos = m.index! + m[0].length
  }
  if (pos < s.length) aus.push({ text: s.slice(pos), ...basis })
  return aus.filter((l) => l.text.length > 0)
}

function schriftFuer(l: { fett: boolean; kursiv: boolean }, f: Schriften): PDFFont {
  return l.fett ? (l.kursiv ? f.fettKursiv : f.fett) : l.kursiv ? f.kursiv : f.normal
}

function umbrechen(text: Lauf[], f: Schriften, groesse: number, maxBreite: number): Zeile[] {
  const woerter: Wort[] = []
  let leer = false
  for (const l of text) {
    const font = schriftFuer(l, f)
    for (const m of l.text.matchAll(/(\s+)|(\S+)/g)) {
      if (m[1]) {
        leer = true
        continue
      }
      const teile = symbolTeile(m[2], font, f)
      if (leer || woerter.length === 0) woerter.push({ teile, leerDavor: leer && woerter.length > 0 })
      else woerter[woerter.length - 1].teile.push(...teile)
      leer = false
    }
  }
  const zeilen: Zeile[] = []
  let akt: Zeile = { teile: [], breite: 0 }
  const breiteVon = (t: Teil) => t.font.widthOfTextAtSize(t.text, groesse)
  for (const w of woerter) {
    const wb = w.teile.reduce((s, t) => s + breiteVon(t), 0)
    const leerTeil: Teil = { text: ' ', font: w.teile[0].font === f.symbol ? f.normal : w.teile[0].font }
    const lb = akt.teile.length > 0 && w.leerDavor ? breiteVon(leerTeil) : 0
    if (akt.breite + lb + wb <= maxBreite) {
      if (lb) akt.teile.push(leerTeil)
      akt.teile.push(...w.teile)
      akt.breite += lb + wb
      continue
    }
    if (akt.teile.length > 0) zeilen.push(akt)
    akt = { teile: [], breite: 0 }
    if (wb <= maxBreite) {
      akt.teile.push(...w.teile)
      akt.breite = wb
      continue
    }
    // Überlanges Wort (z. B. lange Adresse): zeichenweise trennen.
    for (const t of w.teile) {
      for (const z of t.text) {
        const zb = t.font.widthOfTextAtSize(z, groesse)
        if (akt.breite + zb > maxBreite && akt.teile.length > 0) {
          zeilen.push(akt)
          akt = { teile: [], breite: 0 }
        }
        const letzter = akt.teile[akt.teile.length - 1]
        if (letzter && letzter.font === t.font) letzter.text += z
        else akt.teile.push({ text: z, font: t.font })
        akt.breite += zb
      }
    }
  }
  if (akt.teile.length > 0) zeilen.push(akt)
  return zeilen
}

type Block =
  | { art: 'ueberschrift'; ebene: number; text: string }
  | { art: 'absatz'; zeilen: string[] }
  | { art: 'punkt'; ebene: number; marke: string | null; zeilen: string[] }
  | { art: 'zitat'; zeilen: string[] }
  | { art: 'tabelle'; zeilen: string[][] }
  | { art: 'linie' }
  | { art: 'leer' }

function zerlege(inhalt: string): Block[] {
  const bloecke: Block[] = []
  const zeilen = inhalt.split('\n')
  const letzter = () => bloecke[bloecke.length - 1]
  for (let i = 0; i < zeilen.length; i++) {
    const roh = zeilen[i].replace(/\s+$/, '')
    const z = roh.trim()
    if (!z) {
      if (letzter() && letzter().art !== 'leer') bloecke.push({ art: 'leer' })
      continue
    }
    const einzug = (roh.match(/^ */)?.[0].length ?? 0)
    let m: RegExpMatchArray | null
    if ((m = z.match(/^(#{1,6})\s+(.*)$/))) {
      bloecke.push({ art: 'ueberschrift', ebene: Math.min(m[1].length, 3), text: m[2].replace(/\s*#+$/, '') })
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(z)) {
      bloecke.push({ art: 'linie' })
    } else if (z.startsWith('|')) {
      const zellen = z.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      if (zellen.every((c) => /^:?-{2,}:?$/.test(c))) continue
      const l = letzter()
      if (l && l.art === 'tabelle') l.zeilen.push(zellen)
      else bloecke.push({ art: 'tabelle', zeilen: [zellen] })
    } else if ((m = z.match(/^[-*•–]\s+(.*)$/))) {
      bloecke.push({ art: 'punkt', ebene: Math.min(Math.floor(einzug / 2), 3), marke: null, zeilen: [m[1]] })
    } else if ((m = z.match(/^(\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/))) {
      bloecke.push({ art: 'punkt', ebene: Math.min(Math.floor(einzug / 2), 3), marke: m[1].replace(')', '.'), zeilen: [m[2]] })
    } else if (z.startsWith('>')) {
      const text = z.replace(/^>\s?/, '')
      const l = letzter()
      if (l && l.art === 'zitat') l.zeilen.push(text)
      else bloecke.push({ art: 'zitat', zeilen: [text] })
    } else {
      // Einzelner Zeilenumbruch bleibt erhalten (Anschrift, Grußformel); eingerückte Folgezeile
      // eines Aufzählungspunkts gehört zu ihm.
      const l = letzter()
      if (l && l.art === 'punkt' && einzug > 0) l.zeilen.push(z)
      else if (l && l.art === 'absatz') l.zeilen.push(z)
      else bloecke.push({ art: 'absatz', zeilen: [z] })
    }
  }
  return bloecke
}

class Setzer {
  seite!: PDFPage
  y = 0
  seiten: PDFPage[] = []
  constructor(private doc: PDFDocument, private f: Schriften) {}

  get breite() {
    return A4.breite - RAND.links - RAND.rechts
  }

  neueSeite() {
    this.seite = this.doc.addPage([A4.breite, A4.hoehe])
    this.seiten.push(this.seite)
    const top = A4.hoehe - RAND.oben
    this.seite.drawText(FIRMA, { x: RAND.links, y: top - 11, size: 11.5, font: this.f.fett, color: AKZENT })
    this.seite.drawText(FIRMA_ZEILE, { x: RAND.links, y: top - 24, size: 7.8, font: this.f.normal, color: GRAU })
    this.seite.drawLine({ start: { x: RAND.links, y: top - 32 }, end: { x: A4.breite - RAND.rechts, y: top - 32 }, thickness: 0.6, color: LINIE })
    this.y = top - 32 - 26
  }

  /** Sorgt für Platz; sonst neue Seite. */
  platz(hoehe: number) {
    if (this.y - hoehe < RAND.unten + 14) this.neueSeite()
  }

  zeile(z: Zeile, x: number, groesse: number, farbe = TEXT_FARBE) {
    // Gleiche Schrift in einem Stück zeichnen: Dann setzt der Betrachter Wortabstände und Zeichen
    // selbst, auch wenn seine Ersatzschrift minimal andere Breiten hat.
    const stuecke: Teil[] = []
    for (const t of z.teile) {
      const letzter = stuecke[stuecke.length - 1]
      if (letzter && letzter.font === t.font) letzter.text += t.text
      else stuecke.push({ ...t })
    }
    let cx = x
    for (const t of stuecke) {
      this.seite.drawText(t.text, { x: cx, y: this.y, size: groesse, font: t.font, color: farbe })
      cx += t.font.widthOfTextAtSize(t.text, groesse)
    }
  }

  /** Setzt umbrochenen Text ab der aktuellen Höhe; y ist danach unter der letzten Zeile. */
  text(text: Lauf[], x: number, maxBreite: number, groesse = GROESSE, abstand = ZEILE, farbe = TEXT_FARBE) {
    for (const z of umbrechen(text, this.f, groesse, maxBreite)) {
      this.platz(abstand)
      this.y -= abstand - (abstand - groesse) / 2
      this.zeile(z, x, groesse, farbe)
      this.y -= (abstand - groesse) / 2
    }
  }
}

export async function erstellePdf(a: { titel: string; inhalt: string; art?: Art; fuer?: string; datum: string }): Promise<{ bytes: Uint8Array; seiten: number }> {
  const doc = await PDFDocument.create()
  const f: Schriften = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    fett: await doc.embedFont(StandardFonts.HelveticaBold),
    kursiv: await doc.embedFont(StandardFonts.HelveticaOblique),
    fettKursiv: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    symbol: await doc.embedFont(StandardFonts.ZapfDingbats),
  }
  const sauber = zeichenFilter(f.normal)
  const titel = sauber(a.titel)
  const art = a.art ?? 'handout'
  doc.setTitle(titel)
  doc.setAuthor(FIRMA)
  doc.setCreator(`${FIRMA} – CRM`)
  doc.setProducer(`${FIRMA} – CRM`)
  doc.setLanguage('de-DE')

  const s = new Setzer(doc, f)
  s.neueSeite()

  // Kopf der ersten Seite: Art, Titel, für wen und Stand.
  s.y -= 2
  s.seite.drawText(ART_NAME[art].toUpperCase().split('').join(' '), { x: RAND.links, y: s.y - 8, size: 8, font: f.fett, color: GRAU })
  s.y -= 16
  s.text([{ text: titel, fett: true, kursiv: false }], RAND.links, s.breite, 19, 24, AKZENT)
  s.y -= 4
  const meta = [a.fuer ? `Für: ${sauber(a.fuer)}` : '', `Stand: ${langesDatum(a.datum)}`].filter(Boolean).join('   ·   ')
  s.text([{ text: meta, fett: false, kursiv: false }], RAND.links, s.breite, 9.5, 13, GRAU)
  s.y -= 18

  let bloecke = zerlege(sauber(a.inhalt))
  // Wiederholt der Text den Titel als erste Überschrift, fällt sie weg.
  const vergleich = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')
  const erster = bloecke.find((b) => b.art !== 'leer')
  if (erster && erster.art === 'ueberschrift' && vergleich(erster.text.replace(/\*/g, '')) === vergleich(titel)) bloecke = bloecke.slice(bloecke.indexOf(erster) + 1)

  const ABSATZ = 7
  for (let i = 0; i < bloecke.length; i++) {
    const b = bloecke[i]
    const naechster = bloecke[i + 1]
    if (b.art === 'leer') continue
    if (b.art === 'ueberschrift') {
      const groesse = b.ebene === 1 ? 15 : b.ebene === 2 ? 13 : 11.5
      const vorher = b.ebene === 1 ? 16 : b.ebene === 2 ? 12 : 9
      // Überschrift nie allein am Seitenende.
      s.platz(vorher + groesse + 6 + 2 * ZEILE)
      if (s.y < A4.hoehe - RAND.oben - 80) s.y -= vorher
      s.text(laeufe(b.text, { fett: true, kursiv: false }), RAND.links, s.breite, groesse, groesse + 5, b.ebene === 3 ? TEXT_FARBE : AKZENT)
      s.y -= b.ebene === 1 ? 6 : 4
      continue
    }
    if (b.art === 'linie') {
      s.platz(16)
      // Am Seitenanfang trennt eine Linie nichts mehr.
      if (s.y >= A4.hoehe - RAND.oben - 32 - 26 - 0.5) continue
      s.y -= 8
      s.seite.drawLine({ start: { x: RAND.links, y: s.y }, end: { x: A4.breite - RAND.rechts, y: s.y }, thickness: 0.6, color: LINIE })
      s.y -= 10
      continue
    }
    if (b.art === 'absatz') {
      for (const z of b.zeilen) s.text(laeufe(z), RAND.links, s.breite)
      s.y -= ABSATZ
      continue
    }
    if (b.art === 'zitat') {
      const start = s.y
      const seiteVorher = s.seite
      for (const z of b.zeilen) s.text(laeufe(z, { fett: false, kursiv: true }), RAND.links + 14, s.breite - 14, GROESSE, ZEILE, GRAU)
      if (s.seite === seiteVorher) s.seite.drawLine({ start: { x: RAND.links + 3, y: start - 2 }, end: { x: RAND.links + 3, y: s.y + 2 }, thickness: 2, color: LINIE })
      s.y -= ABSATZ
      continue
    }
    if (b.art === 'punkt') {
      const einzug = RAND.links + 4 + b.ebene * 16
      const markeText = b.marke ?? (b.ebene === 0 ? '•' : b.ebene === 1 ? '–' : '·')
      const markeFont = b.marke ? f.normal : f.fett
      const textX = einzug + (b.marke ? Math.max(16, markeFont.widthOfTextAtSize(markeText, GROESSE) + 6) : 12)
      s.platz(ZEILE)
      const markeY = s.y - (ZEILE - (ZEILE - GROESSE) / 2)
      const seiteVorher = s.seite
      for (const z of b.zeilen) s.text(laeufe(z), textX, A4.breite - RAND.rechts - textX)
      // Die Marke steht neben der ersten Zeile; platz() oben stellt sicher, dass die auf dieser Seite liegt.
      seiteVorher.drawText(markeText, { x: einzug, y: markeText === '•' ? markeY - 1.2 : markeY, size: markeText === '•' ? GROESSE * 1.3 : GROESSE, font: markeFont, color: b.marke ? TEXT_FARBE : AKZENT })
      s.y -= naechster && naechster.art === 'punkt' ? 3 : ABSATZ
      continue
    }
    if (b.art === 'tabelle') {
      tabelle(s, f, b.zeilen)
      s.y -= ABSATZ + 2
    }
  }

  // Fußzeile mit Seitenzahlen, wenn die Gesamtzahl feststeht.
  const gesamt = s.seiten.length
  const ohneSymbole = [...titel].filter((z) => !SYMBOLE.has(z)).join('').trim()
  const fussTitel = ohneSymbole.length > 70 ? `${ohneSymbole.slice(0, 68)}…` : ohneSymbole
  s.seiten.forEach((p, i) => {
    const y = RAND.unten - 28
    p.drawLine({ start: { x: RAND.links, y: y + 14 }, end: { x: A4.breite - RAND.rechts, y: y + 14 }, thickness: 0.5, color: LINIE })
    p.drawText(fussTitel, { x: RAND.links, y, size: 8, font: f.normal, color: GRAU })
    const nr = `Seite ${i + 1} von ${gesamt}`
    p.drawText(nr, { x: A4.breite - RAND.rechts - f.normal.widthOfTextAtSize(nr, 8), y, size: 8, font: f.normal, color: GRAU })
  })

  return { bytes: await doc.save(), seiten: gesamt }
}

function tabelle(s: Setzer, f: Schriften, zeilen: string[][]) {
  const spalten = Math.max(...zeilen.map((z) => z.length))
  const pad = 5
  const groesse = 9.5
  const abstand = 13
  // Spaltenbreiten nach dem längsten Inhalt, jede mindestens 12 % der Breite.
  const natuerlich = Array.from({ length: spalten }, (_, c) =>
    Math.max(30, ...zeilen.map((z, r) => (umbrechen(laeufe(z[c] ?? '', { fett: r === 0, kursiv: false }), f, groesse, 1e6)[0]?.breite ?? 0) + 2 * pad)),
  )
  const summe = natuerlich.reduce((a, b) => a + b, 0)
  let breiten = summe <= s.breite ? natuerlich.map((w) => w * (s.breite / summe)) : natuerlich.map((w) => Math.max(s.breite * 0.12, (w / summe) * s.breite))
  const skal = s.breite / breiten.reduce((a, b) => a + b, 0)
  breiten = breiten.map((w) => w * skal)

  zeilen.forEach((z, r) => {
    const kopf = r === 0 && zeilen.length > 1
    const zellen = Array.from({ length: spalten }, (_, c) => umbrechen(laeufe(z[c] ?? '', { fett: kopf, kursiv: false }), f, groesse, breiten[c] - 2 * pad))
    const hoehe = Math.max(1, ...zellen.map((x) => x.length)) * abstand + 2 * pad - 2
    s.platz(hoehe)
    const oben = s.y
    if (kopf) s.seite.drawRectangle({ x: RAND.links, y: oben - hoehe, width: s.breite, height: hoehe, color: TABELLEN_KOPF })
    let x = RAND.links
    zellen.forEach((zellZeilen, c) => {
      s.y = oben - pad + 1
      for (const zz of zellZeilen) {
        s.y -= abstand - (abstand - groesse) / 2
        s.zeile(zz, x + pad, groesse)
        s.y -= (abstand - groesse) / 2
      }
      x += breiten[c]
    })
    s.seite.drawRectangle({ x: RAND.links, y: oben - hoehe, width: s.breite, height: hoehe, borderColor: LINIE, borderWidth: 0.5 })
    let lx = RAND.links
    for (let c = 0; c < spalten - 1; c++) {
      lx += breiten[c]
      s.seite.drawLine({ start: { x: lx, y: oben }, end: { x: lx, y: oben - hoehe }, thickness: 0.5, color: LINIE })
    }
    s.y = oben - hoehe
  })
}
