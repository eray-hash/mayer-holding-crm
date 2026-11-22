// Belege und Angaben der Verbindlichkeiten automatisch ergänzen (22.11.2026).
//
// Lieferantenrechnungen werden aus Mails erkannt (_shared/mailEingang.ts, inbound-email), aber dort nur
// aus dem Mailtext und ohne Beleg: Im Live-Stand hatten alle 10 Verbindlichkeiten keinen Beleg und 6 keinen
// Betrag — der Export für den Steuerberater (_shared/datevExport.ts) meldete entsprechend viele Lücken.
// Dieser Ablauf nimmt sich je Verbindlichkeit mit Original-Mail EINMAL an:
//  - Beleg: hängt an der Mail eine Rechnung (PDF, sonst Bild), wird sie in den Beleg kopiert — genau wie
//    beim Hochladen in der Verbindlichkeit (Speicher „kunden-dokumente“, Ordner verbindlichkeiten/,
//    beleg = { name, url: Pfad, typ }). Reine HTML-Belege (z. B. PayPal-Zahlungsbelege) werden als
//    einfaches PDF aus dem Mailtext abgelegt — aber nur, wenn die KI sie als Rechnung oder Zahlungsbeleg
//    erkennt (nicht bei „Ihre Rechnung liegt im Kundenkonto“ oder Werbung/Betrugsversuchen).
//  - Angaben: Haiku 5.5 liest Betrag (brutto/netto/Steuer), Rechnungsdatum, Rechnungsnummer, Lieferant,
//    Zahlungsziel und Kategorie aus dem PDF (bereits gelesener Text aus dokument_inhalte, sonst das PDF
//    selbst) bzw. aus dem Mailtext. Es werden NUR LEERE FELDER gefüllt; Ausnahmen, weil dort beim Anlegen nur
//    ein Platzhalter stand: Betrag 0 (wenn der Beleg einen echten Betrag nennt), Rechnungsdatum = Tag des
//    automatischen Anlegens, Lieferant = Absenderadresse oder „PayPal“ (bei PayPal-Belegen ist der Händler
//    der Lieferant).
//  - Kennzeichnung: Spalte automatisch_erkannt (stand, art, felder, beleg) und eine Zeile in der Notiz
//    „Automatisch ergänzt am … — bitte prüfen“. „Angaben stimmen“ (geprueft) setzt weiterhin nur ein Mensch;
//    bereits geprüfte Verbindlichkeiten bekommen höchstens den Beleg, ihre Angaben bleiben unangetastet.
//
// Takt: vom Minuten-Zeitplan (termin_erinnerungen) gerufen, höchstens alle 2 Minuten und dann bis zu 3
// Verbindlichkeiten. Einmaliger Lauf für alle: Aktion beleg_ergaenzen (nur Geschäftsführung) mit Vorschau.
// Beide teilen sich einen Merker in abteilung_eintraege ('beleg_ergaenzen_stand') mit Sperre bis
// (laeuftBis) — nie zwei Läufe gleichzeitig. Ohne Nachrichten an irgendwen.

import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { kiAufruf } from '../_shared/kiVerbrauch.ts'
import { htmlZuText } from '../_shared/signaturDaten.ts'
import { eigenerSpeicher } from '../_shared/speicherPfad.ts'
import { VERBINDLICHKEIT_KATEGORIEN } from '../_shared/datevExport.ts'
import { angabenAusZeile, belegLuecken, erkanntAus, FELD_NAMEN, hatBeleg } from '../_shared/belegLuecken.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const TABELLE_STAND = 'abteilung_eintraege'
export const STAND_ID = 'beleg_ergaenzen_stand'
const TAKT_MS = 2 * 60 * 1000
const SPERRE_MS = 4 * 60 * 1000
const JE_LAUF = 3
const JE_AKTION = 20
export const MAX_VERSUCHE = 3
const WIEDERHOLEN_NACH_MS = 60 * 60 * 1000
const BELEG_EIMER = 'kunden-dokumente'
const BELEG_ORDNER = 'verbindlichkeiten'
const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_BILD_BYTES = 5 * 1024 * 1024
export const MODELL = 'claude-haiku-5-5'
const KI_ZEIT_MS = 60_000

export const VERB_SPALTEN =
  'id, lieferant, lieferant_email, rechnungsnummer, datum, betrag_netto, betrag_brutto, zahlungsziel, status, notiz, quelle, quell_email_id, erstellt_am, kategorie, beleg, geprueft, automatisch_erkannt'
const MAIL_SPALTEN = 'id, message_id, von, von_name, betreff, mail_datum, erstellt_am, ausschnitt, anhaenge, besitzer_email, rohdaten'

export type VerbZeile = {
  id: string
  lieferant: string | null
  lieferant_email: string | null
  rechnungsnummer: string | null
  datum: string | null
  betrag_netto: number | string | null
  betrag_brutto: number | string | null
  zahlungsziel: string | null
  status: string | null
  notiz: string | null
  quelle: string | null
  quell_email_id: string | null
  erstellt_am: string | null
  kategorie: string | null
  beleg: { name?: string; url?: string; typ?: string } | null
  geprueft: boolean | null
  automatisch_erkannt?: unknown
}

export type Anhang = { filename?: string; size?: number; contentType?: string; url?: string }

export type MailZeile = {
  id: string
  message_id: string
  von: string | null
  von_name: string | null
  betreff: string | null
  mail_datum: string | null
  erstellt_am: string | null
  ausschnitt: string | null
  anhaenge: Anhang[] | null
  besitzer_email: string | null
  rohdaten?: { html?: unknown } | null
}

export type KiBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** Antwort der KI (Werkzeug beleg_auslesen), roh. */
export type KiAuslesen = (inhalt: KiBlock[]) => Promise<Record<string, unknown>>

export type BelegHelfer = {
  /** KI-Auslese; fehlt sie (kein Schlüssel), werden nur Anhänge übernommen und keine HTML-Belege erzeugt. */
  ki?: KiAuslesen
  /** Datei einer Mail laden. Vorgabe: eigener Speicher (speicherPfad.eigenerSpeicher). In index.ts: ladeDokumentBytes. */
  ladeBytes?: (url: string) => Promise<Uint8Array>
  /** Wie lange dieser Aufruf noch arbeiten darf (Millisekunden). */
  restMs?: () => number
}

/** Was aus Beleg/Mail gelesen wurde, bereinigt. */
export type Auslese = {
  art: 'rechnung' | 'zahlungsbeleg' | 'nur_im_kundenkonto' | 'keine_rechnung' | 'unklar'
  lieferant?: string
  rechnungsnummer?: string
  datum?: string
  brutto?: number
  netto?: number
  steuer?: number
  zahlungsziel?: string
  kategorie?: string
}

export type BelegQuelle = { art: 'mail_anhang'; anhang: Anhang } | { art: 'mail_text' } | null

// ---------------------------------------------------------------------------------------------
// Reine Regeln

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function zahl(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

const heuteBerlin = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)
const datumDe = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)

function istPdf(a: Anhang): boolean {
  return /pdf/i.test(text(a.contentType)) || /\.pdf$/i.test(text(a.filename))
}

function istBild(a: Anhang): boolean {
  return /^image\/(jpe?g|png|webp|gif)$/i.test(text(a.contentType)) || /\.(jpe?g|png|webp|gif)$/i.test(text(a.filename))
}

const KEIN_BELEG = /agb|terms|condition|bedingung|widerruf|datenschutz|privacy|preisliste|newsletter|logo|signatur|banner/i
const BELEG_NAME = /rechnung|invoice|beleg|quittung|receipt|gutschrift|kostennote|honorar|^ra[_-]|^re[_-]?\d|faktura/i

/**
 * Welcher Anhang ist die Rechnung? PDFs vor Bildern; AGB, Datenschutz u. ä. nie; Namen wie „Rechnung…“
 * zuerst. Bilder nur, wenn ihr Name nach Rechnung klingt (sonst sind es meist Logos aus der Signatur).
 */
export function waehleRechnungsAnhang(anhaenge: Anhang[] | null | undefined): Anhang | null {
  const liste = (Array.isArray(anhaenge) ? anhaenge : []).filter((a) => a && text(a.url).trim() && !KEIN_BELEG.test(text(a.filename)))
  const pdfs = liste.filter(istPdf)
  const pdf = pdfs.find((a) => BELEG_NAME.test(text(a.filename))) ?? pdfs[0]
  if (pdf) return pdf
  return liste.filter(istBild).find((a) => BELEG_NAME.test(text(a.filename))) ?? null
}

/** Datenbank-Spalten mit einem Platzhalter statt echter Angabe (siehe Kopf). */
function lieferantIstPlatzhalter(v: Pick<VerbZeile, 'lieferant' | 'lieferant_email'>): boolean {
  const l = text(v.lieferant).trim()
  return !l || l.includes('@') || /^paypal( \(europe\).*)?$/i.test(l) || (!!v.lieferant_email && l.toLowerCase() === text(v.lieferant_email).toLowerCase())
}

function datumIstPlatzhalter(v: Pick<VerbZeile, 'datum' | 'erstellt_am' | 'quelle'>): boolean {
  if (!text(v.datum).trim()) return true
  if (v.quelle !== 'email-automatisch' || !v.erstellt_am) return false
  return text(v.datum).slice(0, 10) === heuteBerlin(new Date(v.erstellt_am))
}

/** Fehlt etwas, das dieser Ablauf ergänzen kann? (Beleg, Betrag, Nettobetrag, Rechnungsnummer) */
export function brauchtErgaenzung(v: VerbZeile): boolean {
  const l = belegLuecken(angabenAusZeile(v as unknown as Record<string, unknown>))
  return l.some((x) => x.art === 'beleg' || x.art === 'betrag' || x.art === 'betrag_null' || x.art === 'nummer' || x.art === 'netto')
}

/** Kommt die Verbindlichkeit jetzt dran? Nur mit Original-Mail, einmal (Fehler: bis zu MAX_VERSUCHE, frühestens nach einer Stunde). */
export function kommtDran(v: VerbZeile, jetzt = new Date()): boolean {
  if (!text(v.quell_email_id).trim()) return false
  const e = erkanntAus(v.automatisch_erkannt)
  if (e?.stand === 'fertig') return false
  if (e?.stand === 'fehler') {
    if ((e.versuche ?? 0) >= MAX_VERSUCHE) return false
    const am = Date.parse(e.am ?? '')
    if (Number.isFinite(am) && jetzt.getTime() - am < WIEDERHOLEN_NACH_MS) return false
  }
  return brauchtErgaenzung(v)
}

/** Woher käme der Beleg? (ohne KI-Entscheidung: mail_text nur als Möglichkeit) */
export function belegQuelle(v: VerbZeile, mail: MailZeile | null): BelegQuelle {
  if (hatBeleg(v) || !mail) return null
  const anhang = waehleRechnungsAnhang(mail.anhaenge)
  if (anhang) return { art: 'mail_anhang', anhang }
  return mailText(mail).trim().length >= 40 ? { art: 'mail_text' } : null
}

function istDatum(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

function betrag(x: unknown): number | undefined {
  const n = typeof x === 'string' ? Number(x.replace(/\./g, '').replace(',', '.')) : Number(x)
  if (x === null || x === undefined || x === '' || !Number.isFinite(n) || Math.abs(n) > 10_000_000) return undefined
  return Math.round(n * 100) / 100
}

/** KI-Antwort prüfen und vereinheitlichen; Unsinn fällt weg. */
export function bereinigeAuslese(roh: Record<string, unknown>, jetzt = new Date()): Auslese {
  const arten: Auslese['art'][] = ['rechnung', 'zahlungsbeleg', 'nur_im_kundenkonto', 'keine_rechnung']
  const art = arten.includes(roh.art as Auslese['art']) ? (roh.art as Auslese['art']) : 'unklar'
  const a: Auslese = { art }
  const lieferant = text(roh.lieferant).trim().slice(0, 120)
  if (lieferant && !lieferant.includes('@')) a.lieferant = lieferant
  const nr = text(roh.rechnungsnummer).trim().slice(0, 60)
  if (nr && /[0-9A-Za-z]/.test(nr)) a.rechnungsnummer = nr
  const heute = heuteBerlin(jetzt)
  const vor3Jahren = `${Number(heute.slice(0, 4)) - 3}${heute.slice(4)}`
  if (istDatum(roh.rechnungsdatum) && roh.rechnungsdatum <= heute && roh.rechnungsdatum >= vor3Jahren) a.datum = roh.rechnungsdatum
  if (istDatum(roh.zahlungsziel) && roh.zahlungsziel >= vor3Jahren) a.zahlungsziel = roh.zahlungsziel
  const brutto = betrag(roh.betrag_brutto)
  let netto = betrag(roh.betrag_netto)
  const steuer = betrag(roh.umsatzsteuer_betrag)
  const fremdeWaehrung = !!text(roh.waehrung).trim() && !/^(eur|€|euro)$/i.test(text(roh.waehrung).trim())
  if (!fremdeWaehrung) {
    if (brutto !== undefined && brutto >= 0) a.brutto = brutto
    if (netto === undefined && a.brutto !== undefined && steuer !== undefined && steuer >= 0 && steuer <= a.brutto) netto = Math.round((a.brutto - steuer) * 100) / 100
    if (netto !== undefined && netto >= 0 && (a.brutto === undefined || netto <= a.brutto + 0.01)) a.netto = netto
    if (steuer !== undefined && steuer >= 0) a.steuer = steuer
  }
  const kat = text(roh.kategorie).trim()
  if ((VERBINDLICHKEIT_KATEGORIEN as readonly string[]).includes(kat)) a.kategorie = kat
  return a
}

/**
 * Welche Felder dürfen gefüllt werden? Nur leere (und die Platzhalter aus dem Kopf). Bereits geprüfte
 * Verbindlichkeiten: nichts. Rechnet nur.
 */
export function planeFelder(v: VerbZeile, a: Auslese): Record<string, string | number> {
  const f: Record<string, string | number> = {}
  if (v.geprueft === true) return f
  if (a.art === 'keine_rechnung' || a.art === 'nur_im_kundenkonto') return f
  const brutto = zahl(v.betrag_brutto)
  const netto = zahl(v.betrag_netto)
  if (a.brutto !== undefined && (brutto === null || (brutto === 0 && a.brutto > 0))) f.betrag_brutto = a.brutto
  const bruttoNeu = (f.betrag_brutto as number | undefined) ?? brutto
  if (a.netto !== undefined && (netto === null || (netto === 0 && a.netto > 0)) && (bruttoNeu === null || a.netto <= bruttoNeu + 0.01)) f.betrag_netto = a.netto
  if (a.rechnungsnummer && !text(v.rechnungsnummer).trim()) f.rechnungsnummer = a.rechnungsnummer
  if (a.datum && datumIstPlatzhalter(v) && a.datum !== text(v.datum).slice(0, 10)) f.datum = a.datum
  if (a.zahlungsziel && !text(v.zahlungsziel).trim() && v.status !== 'bezahlt') f.zahlungsziel = a.zahlungsziel
  if (a.kategorie && !text(v.kategorie).trim()) f.kategorie = a.kategorie
  if (a.lieferant && lieferantIstPlatzhalter(v) && a.lieferant !== text(v.lieferant).trim()) f.lieferant = a.lieferant
  return f
}

/** Notizzeile zur Kennzeichnung. */
export function notizZeile(heute: string, a: Auslese | null, felder: string[], beleg: BelegQuelle): string {
  const datum = datumDe(heute)
  if (a?.art === 'keine_rechnung') return `Automatisch geprüft am ${datum}: wohl keine echte Rechnung (Werbung oder Betrugsversuch?) — bitte prüfen und ggf. löschen.`
  if (a?.art === 'nur_im_kundenkonto' && !beleg) return `Automatisch geprüft am ${datum}: Die Rechnung liegt nur im Kundenkonto des Anbieters — bitte dort herunterladen und als Beleg hochladen.`
  const teile: string[] = []
  if (beleg?.art === 'mail_anhang') teile.push(`Beleg (Anhang der Mail „${text(beleg.anhang.filename)}“)`)
  if (beleg?.art === 'mail_text') teile.push('Beleg (PDF aus dem Mailtext)')
  teile.push(...felder.map((f) => FELD_NAMEN[f] ?? f))
  if (!teile.length) return ''
  return `Automatisch ergänzt am ${datum}: ${teile.join(', ')} — bitte prüfen.`
}

// ---------------------------------------------------------------------------------------------
// Mailtext und PDF aus dem Mailtext

/** Lesbarer Text der Mail: der gespeicherte Ausschnitt, bei sehr kurzem Ausschnitt das HTML. */
export function mailText(m: Pick<MailZeile, 'ausschnitt' | 'rohdaten'>): string {
  let t = text(m.ausschnitt)
  const html = m.rohdaten && typeof m.rohdaten === 'object' ? m.rohdaten.html : undefined
  if (t.trim().length < 200 && typeof html === 'string' && html.trim()) t = html
  return htmlZuText(t.replace(/&zwn?j;/gi, ''))
    .replace(/[​-‍⁠﻿͏]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((z) => z.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ERSATZ: Record<string, string> = { '\t': '    ', '‐': '-', '‑': '-', '−': '-', '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'x', '✔': 'x', '●': '•', '▪': '•' }

function zeichenFilter(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  return (s) => {
    let aus = ''
    for (const z of s) {
      if (erlaubt.has(z.codePointAt(0)!)) aus += z
      else if (z in ERSATZ) aus += ERSATZ[z]
      else {
        const basis = z.normalize('NFD').replace(/[̀-ͯ]/g, '')
        aus += basis && [...basis].every((b) => erlaubt.has(b.codePointAt(0)!)) ? basis : /\p{L}|\p{N}/u.test(z) ? '?' : ''
      }
    }
    return aus
  }
}

function umbrechen(zeile: string, font: PDFFont, groesse: number, max: number): string[] {
  if (!zeile) return ['']
  const aus: string[] = []
  let aktuell = ''
  for (const wort of zeile.split(' ')) {
    const probe = aktuell ? `${aktuell} ${wort}` : wort
    if (font.widthOfTextAtSize(probe, groesse) <= max) {
      aktuell = probe
      continue
    }
    if (aktuell) aus.push(aktuell)
    // Überlange Wörter (Links) zeichenweise trennen.
    let rest = wort
    while (font.widthOfTextAtSize(rest, groesse) > max) {
      let n = rest.length
      while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), groesse) > max) n--
      aus.push(rest.slice(0, n))
      rest = rest.slice(n)
    }
    aktuell = rest
  }
  if (aktuell) aus.push(aktuell)
  return aus
}

/** Einfaches A4-PDF aus einer Mail: Kopf (Von, Betreff, Datum) und Text. */
export async function pdfAusMail(m: Pick<MailZeile, 'von' | 'von_name' | 'betreff' | 'mail_datum' | 'erstellt_am' | 'ausschnitt' | 'rohdaten'>, erzeugtAm = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(text(m.betreff) || 'Beleg aus E-Mail')
  pdf.setCreator('Mayer Holding CRM')
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sauber = zeichenFilter(normal)
  const [breite, hoehe] = [595.28, 841.89]
  const rand = 50
  const max = breite - 2 * rand
  let seite = pdf.addPage([breite, hoehe])
  let y = hoehe - rand
  const neueSeite = () => {
    seite = pdf.addPage([breite, hoehe])
    y = hoehe - rand
  }
  const schreibe = (z: string, font: PDFFont, groesse: number, farbe = rgb(0.1, 0.1, 0.1)) => {
    for (const teil of umbrechen(sauber(z), font, groesse, max)) {
      if (y < rand + groesse) neueSeite()
      seite.drawText(teil, { x: rand, y: y - groesse, size: groesse, font, color: farbe })
      y -= groesse * 1.35
    }
  }
  const datum = text(m.mail_datum || m.erstellt_am)
  schreibe('Beleg aus E-Mail', fett, 14)
  y -= 4
  const name = text(m.von_name).trim()
  const adresse = text(m.von).trim()
  schreibe(`Von: ${name && name.toLowerCase() !== adresse.toLowerCase() ? `${name}${adresse ? ` <${adresse}>` : ''}` : adresse || name}`, normal, 9.5)
  if (datum) schreibe(`Datum: ${datumDe(heuteBerlin(new Date(datum)))}`, normal, 9.5)
  schreibe(`Betreff: ${text(m.betreff)}`, normal, 9.5)
  y -= 6
  seite.drawLine({ start: { x: rand, y }, end: { x: breite - rand, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) })
  y -= 10
  for (const z of mailText(m).split('\n')) schreibe(z, normal, 9.5)
  y -= 10
  schreibe(`Automatisch aus der E-Mail erzeugt am ${datumDe(heuteBerlin(erzeugtAm))} (Mayer Holding CRM). Die Mail enthielt keinen Anhang.`, normal, 7.5, rgb(0.45, 0.45, 0.45))
  return await pdf.save()
}

// ---------------------------------------------------------------------------------------------
// KI

export const WERKZEUG = {
  name: 'beleg_auslesen',
  description: 'Gibt die Angaben einer Eingangsrechnung bzw. eines Zahlungsbelegs zurück, die Mayer Holding bezahlen muss oder bezahlt hat.',
  input_schema: {
    type: 'object',
    properties: {
      art: {
        type: 'string',
        enum: ['rechnung', 'zahlungsbeleg', 'nur_im_kundenkonto', 'keine_rechnung'],
        description:
          'rechnung = Rechnung/Kostennote mit Betrag; zahlungsbeleg = Beleg über eine bereits geleistete Zahlung (z. B. PayPal, Kartenzahlung) mit Händler und Betrag; nur_im_kundenkonto = Mail kündigt nur an, dass die Rechnung im Kundenkonto/Portal des Anbieters liegt, ohne Betrag; keine_rechnung = Werbung, Mahnungs-Betrugsversuch, Vertrag ohne Rechnung o. ä.',
      },
      lieferant: { type: 'string', description: 'Wer die Leistung erbracht hat bzw. das Geld bekommt (bei PayPal-Belegen der Händler, nicht PayPal). Weglassen, wenn unklar.' },
      rechnungsnummer: { type: 'string', description: 'Rechnungsnummer; bei Zahlungsbelegen ohne Rechnungsnummer die Bestell- oder Transaktionsnummer. Sonst weglassen.' },
      rechnungsdatum: { type: 'string', description: 'Rechnungs- bzw. Zahlungsdatum im Format JJJJ-MM-TT' },
      betrag_brutto: { type: 'number', description: 'Gesamtbetrag (brutto) in Euro' },
      betrag_netto: { type: 'number', description: 'Nettobetrag in Euro, nur wenn er auf dem Beleg steht' },
      umsatzsteuer_betrag: { type: 'number', description: 'ausgewiesene Umsatzsteuer/Mehrwertsteuer in Euro, nur wenn sie auf dem Beleg steht' },
      umsatzsteuer_satz: { type: 'number', description: 'Steuersatz in Prozent, z. B. 19' },
      waehrung: { type: 'string', description: 'Währung, z. B. EUR oder USD' },
      zahlungsziel: { type: 'string', description: 'Fälligkeitsdatum im Format JJJJ-MM-TT, nur wenn genannt' },
      kategorie: { type: 'string', enum: [...VERBINDLICHKEIT_KATEGORIEN], description: 'Passende Kategorie' },
    },
    required: ['art'],
  },
}

export function auftrag(v: VerbZeile, mail: MailZeile | null, mitDatei: boolean): string {
  return `Du liest einen Beleg für die Buchhaltung der Mayer Holding (Unternehmensberatung, Ulm). ${mitDatei ? 'Der Beleg ist die angehängte Datei; der Mailtext unten ist nur Zusammenhang.' : 'Der Beleg ist der Mailtext unten (die Mail hat keinen Anhang).'}
Übernimm nur Angaben, die wirklich dastehen — nichts schätzen, nichts ausrechnen außer dem Weglassen. Beträge als Zahl in Euro (Punkt als Dezimaltrenner). Wenn ein Betrag von 0,00 € dasteht, gib 0 an.
Achtung Betrug: Mails mit „Zahlung fehlgeschlagen“, Dollarbeträgen und „jetzt reaktivieren“ von unbekannten Absendern sind meist keine echte Rechnung.

Bisher erfasst: Lieferant „${text(v.lieferant)}“, Absender ${text(mail?.von_name)} <${text(mail?.von)}>, Betreff „${text(mail?.betreff)}“.

Mailtext:
${mail ? mailText(mail).slice(0, mitDatei ? 1500 : 8000) : '(nicht gefunden)'}`
}

function bytesNachBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Haiku 5.5 ohne Nachdenken mit erzwungener Werkzeug-Antwort, Verbrauch über kiAufruf gemessen. */
export function haikuAuslesen(apiKey: string): KiAuslesen {
  return async (inhalt) => {
    const antwort = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(KI_ZEIT_MS),
      body: JSON.stringify({
        model: MODELL,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
        tools: [WERKZEUG],
        tool_choice: { type: 'tool', name: WERKZEUG.name },
        messages: [{ role: 'user', content: inhalt }],
      }),
    })
    if (!antwort.ok) throw new Error(`KI-Dienst antwortet mit ${antwort.status}: ${(await antwort.text().catch(() => '')).slice(0, 200)}`)
    const daten = await antwort.json()
    const block = daten?.content?.find((c: { type?: string }) => c.type === 'tool_use')
    if (!block?.input) throw new Error('Keine verwertbare Antwort vom KI-Dienst')
    return block.input as Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------------------------
// Datenbank und Speicher

async function standardLadeBytes(admin: Db, url: string): Promise<Uint8Array> {
  const ort = eigenerSpeicher(url)
  if (!ort) throw new Error('Datei nicht abrufbar (Verweis zeigt nicht auf den eigenen Speicher)')
  const { data, error } = await admin.storage.from(ort.eimer).download(ort.pfad)
  if (error || !data) throw new Error(`Datei nicht abrufbar (${error?.message ?? 'unbekannt'})`)
  return new Uint8Array(await data.arrayBuffer())
}

/** Schlüssel in dokument_inhalte (wie dokumentSchluessel in index.ts für Mail-Anhänge). */
function dokumentSchluessel(url: string): string | null {
  const marker = '/object/public/'
  if (!/^https?:\/\//i.test(url) || !url.includes(marker)) return null
  try {
    return decodeURIComponent(url.split(marker)[1].split('?')[0])
  } catch {
    return null
  }
}

/** Mail zur Verbindlichkeit: bevorzugt die im gemeinsamen Postfach. */
export async function ladeMail(admin: Db, messageId: string): Promise<MailZeile | null> {
  const { data, error } = await admin.from('eingegangene_emails').select(MAIL_SPALTEN).eq('message_id', messageId).limit(5)
  if (error) throw new Error(`Mail nicht lesbar: ${error.message}`)
  const liste = (data ?? []) as MailZeile[]
  return liste.find((m) => !m.besitzer_email) ?? liste[0] ?? null
}

/** Alle Verbindlichkeiten (seitenweise nach id). */
export async function ladeVerbindlichkeiten(admin: Db): Promise<VerbZeile[]> {
  const alle: VerbZeile[] = []
  let ab = ''
  for (let i = 0; i < 50; i++) {
    let q = admin.from('verbindlichkeiten').select(VERB_SPALTEN).order('id', { ascending: true }).limit(500)
    if (ab) q = q.gt('id', ab)
    const { data, error } = await q
    if (error) throw new Error(`Verbindlichkeiten nicht lesbar: ${error.message}`)
    const seite = (data ?? []) as VerbZeile[]
    alle.push(...seite)
    if (seite.length < 500) break
    ab = seite[seite.length - 1].id
  }
  return alle
}

function sichererName(name: string): string {
  const n = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '')
  return (n || 'beleg').slice(-120)
}

async function legeBelegAb(admin: Db, bytes: Uint8Array, name: string, typ: string): Promise<{ name: string; url: string; typ: string }> {
  const pfad = `${BELEG_ORDNER}/dok_${crypto.randomUUID().slice(0, 12)}_${sichererName(name)}`
  const { error } = await admin.storage.from(BELEG_EIMER).upload(pfad, bytes, { contentType: typ, upsert: false })
  if (error) throw new Error(`Beleg nicht speicherbar: ${error.message}`)
  return { name, url: pfad, typ }
}

// ---------------------------------------------------------------------------------------------
// Eine Verbindlichkeit

export type Ergebnis = {
  id: string
  lieferant: string
  beleg: 'mail_anhang' | 'mail_text' | null
  felder: string[]
  art: Auslese['art'] | null
  fehler?: string
}

/**
 * Ergänzt eine Verbindlichkeit (Beleg, leere Angaben, Kennzeichnung). Wirft bei Fehlern; der Aufrufer
 * vermerkt sie in automatisch_erkannt (stand 'fehler').
 */
export async function ergaenzeVerbindlichkeit(admin: Db, v: VerbZeile, h: BelegHelfer, jetzt = new Date()): Promise<Ergebnis> {
  const erg: Ergebnis = { id: v.id, lieferant: text(v.lieferant), beleg: null, felder: [], art: null }
  const mail = v.quell_email_id ? await ladeMail(admin, v.quell_email_id) : null
  if (!mail) throw new Error('Original-Mail nicht gefunden')
  const quelle = belegQuelle(v, mail)
  const lade = h.ladeBytes ?? ((url: string) => standardLadeBytes(admin, url))
  // KI: wenn Angaben fehlen, oder um bei reinen Mail-Belegen zu entscheiden, ob es ein Beleg ist.
  const angabenFehlen = v.geprueft !== true && brauchtErgaenzung({ ...v, beleg: { url: 'x' } })
  const kiNoetig = angabenFehlen || quelle?.art === 'mail_text'
  if (kiNoetig && !h.ki) throw new Error('KI-Schlüssel fehlt')

  // Datei des Rechnungs-Anhangs — für den Beleg (muss sich laden lassen) und als Vorlage für die KI
  // (auch wenn schon ein Beleg von Hand da ist).
  const anhang = waehleRechnungsAnhang(mail.anhaenge)
  let anhangBytes: Uint8Array | null = null
  if (anhang && quelle?.art === 'mail_anhang') anhangBytes = await lade(text(anhang.url))
  else if (anhang && kiNoetig) anhangBytes = await lade(text(anhang.url)).catch(() => null)

  let auslese: Auslese | null = null
  if (kiNoetig && h.ki) {
    let dateiBlock: KiBlock | null = null
    if (anhang && anhangBytes) {
      const schluessel = dokumentSchluessel(text(anhang.url))
      const { data: gelesen } = schluessel
        ? await admin.from('dokument_inhalte').select('status, inhalt').eq('schluessel', schluessel).maybeSingle()
        : { data: null }
      if (gelesen?.status === 'gelesen' && text(gelesen.inhalt).trim().length > 50) {
        dateiBlock = { type: 'text', text: `Inhalt der angehängten Datei „${text(anhang.filename)}“:\n${text(gelesen.inhalt).slice(0, 20000)}` }
      } else if (istPdf(anhang) && anhangBytes.length <= MAX_PDF_BYTES) {
        dateiBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesNachBase64(anhangBytes) } }
      } else if (istBild(anhang) && anhangBytes.length <= MAX_BILD_BYTES) {
        const art = text(anhang.contentType) + text(anhang.filename)
        dateiBlock = { type: 'image', source: { type: 'base64', media_type: /png/i.test(art) ? 'image/png' : /webp/i.test(art) ? 'image/webp' : 'image/jpeg', data: bytesNachBase64(anhangBytes) } }
      }
    }
    let roh: Record<string, unknown>
    try {
      roh = await h.ki(dateiBlock ? [dateiBlock, { type: 'text', text: auftrag(v, mail, true) }] : [{ type: 'text', text: auftrag(v, mail, false) }])
    } catch (err) {
      // Lehnt der KI-Dienst die Datei ab (beschädigt, verschlüsselt), wenigstens den Mailtext lesen.
      if (!dateiBlock || !/ 400/.test(err instanceof Error ? err.message : '')) throw err
      roh = await h.ki([{ type: 'text', text: auftrag(v, mail, false) }])
    }
    auslese = bereinigeAuslese(roh, jetzt)
    erg.art = auslese.art
  }

  // Beleg ablegen
  let beleg: { name: string; url: string; typ: string } | null = null
  let belegArt: BelegQuelle = null
  if (quelle?.art === 'mail_anhang' && anhangBytes && auslese?.art !== 'keine_rechnung') {
    const name = text(quelle.anhang.filename) || 'Rechnung.pdf'
    beleg = await legeBelegAb(admin, anhangBytes, name, text(quelle.anhang.contentType) || (istPdf(quelle.anhang) ? 'application/pdf' : 'application/octet-stream'))
    belegArt = quelle
  } else if (quelle?.art === 'mail_text' && auslese && (auslese.art === 'rechnung' || auslese.art === 'zahlungsbeleg')) {
    const bytes = await pdfAusMail(mail, jetzt)
    const wer = auslese.lieferant || text(v.lieferant) || 'Beleg'
    const datum = auslese.datum || text(v.datum).slice(0, 10)
    beleg = await legeBelegAb(admin, bytes, `Beleg aus E-Mail ${wer} ${datumDe(datum)}.pdf`, 'application/pdf')
    belegArt = quelle
  }

  // Schreiben: frisch lesen, nur noch Leeres füllen.
  const { data: frisch, error: lesefehler } = await admin.from('verbindlichkeiten').select(VERB_SPALTEN).eq('id', v.id).maybeSingle()
  if (lesefehler) throw new Error(`Verbindlichkeit nicht lesbar: ${lesefehler.message}`)
  if (!frisch) {
    if (beleg) await admin.storage.from(BELEG_EIMER).remove([beleg.url])
    throw new Error('Verbindlichkeit inzwischen gelöscht')
  }
  const f = frisch as VerbZeile
  const aenderung: Record<string, unknown> = auslese ? planeFelder(f, auslese) : {}
  erg.felder = Object.keys(aenderung)
  if (beleg) {
    if (hatBeleg(f)) {
      await admin.storage.from(BELEG_EIMER).remove([beleg.url])
      belegArt = null
    } else {
      aenderung.beleg = beleg
      erg.beleg = belegArt?.art ?? null
    }
  }
  const zeile = notizZeile(heuteBerlin(jetzt), auslese, erg.felder, erg.beleg ? belegArt : null)
  if (zeile) aenderung.notiz = text(f.notiz).trim() ? `${text(f.notiz).trim()}\n${zeile}` : zeile
  const bisher = erkanntAus(f.automatisch_erkannt)
  aenderung.automatisch_erkannt = {
    stand: 'fertig',
    am: jetzt.toISOString(),
    art: auslese?.art ?? null,
    felder: erg.felder,
    beleg: erg.beleg,
    versuche: (bisher?.versuche ?? 0) + 1,
  }
  const { error } = await admin.from('verbindlichkeiten').update(aenderung).eq('id', v.id)
  if (error) {
    if (beleg && erg.beleg) await admin.storage.from(BELEG_EIMER).remove([beleg.url])
    throw new Error(`Verbindlichkeit nicht speicherbar: ${error.message}`)
  }
  return erg
}

async function merkeFehler(admin: Db, v: VerbZeile, fehler: string, jetzt: Date): Promise<void> {
  const bisher = erkanntAus(v.automatisch_erkannt)
  await admin
    .from('verbindlichkeiten')
    .update({ automatisch_erkannt: { stand: 'fehler', am: jetzt.toISOString(), fehler: fehler.slice(0, 300), versuche: (bisher?.versuche ?? 0) + 1, felder: [], beleg: null } })
    .eq('id', v.id)
}

// ---------------------------------------------------------------------------------------------
// Sperre (ein Lauf zur Zeit) und Zeitplan

type Stand = { letzterLauf?: string; laeuftBis?: string }

/** Lauf beanspruchen: nur wer den Stand weiterstellt, arbeitet. ohneTakt: Aktion der Geschäftsführung. */
async function beanspruche(admin: Db, jetzt: Date, ohneTakt: boolean): Promise<'ok' | 'takt' | 'belegt'> {
  const jetztIso = jetzt.toISOString()
  const { data: stand, error } = await admin.from(TABELLE_STAND).select('daten, updated_at').eq('id', STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  const daten = (stand?.daten && typeof stand.daten === 'object' ? stand.daten : {}) as Stand
  const bis = Date.parse(daten.laeuftBis ?? '')
  if (Number.isFinite(bis) && bis > jetzt.getTime()) return 'belegt'
  if (!ohneTakt && daten.letzterLauf) {
    const letzter = Date.parse(daten.letzterLauf)
    if (Number.isFinite(letzter) && Math.abs(jetzt.getTime() - letzter) < TAKT_MS) return 'takt'
  }
  const neu = { letzterLauf: jetztIso, laeuftBis: new Date(jetzt.getTime() + SPERRE_MS).toISOString() }
  if (!stand) {
    const { error: anlegeFehler } = await admin.from(TABELLE_STAND).insert({ id: STAND_ID, art: STAND_ID, daten: neu, updated_at: jetztIso })
    return anlegeFehler ? 'belegt' : 'ok'
  }
  const { data: beansprucht, error: anspruchFehler } = await admin
    .from(TABELLE_STAND)
    .update({ daten: { ...daten, ...neu }, updated_at: jetztIso })
    .eq('id', STAND_ID)
    .eq('updated_at', stand.updated_at)
    .select('id')
  if (anspruchFehler) throw new Error(`Stand nicht schreibbar: ${anspruchFehler.message}`)
  return Array.isArray(beansprucht) && beansprucht.length > 0 ? 'ok' : 'belegt'
}

async function gebeFrei(admin: Db, jetzt: Date): Promise<void> {
  await admin
    .from(TABELLE_STAND)
    .update({ daten: { letzterLauf: jetzt.toISOString(), laeuftBis: null }, updated_at: new Date().toISOString() })
    .eq('id', STAND_ID)
}

export type LaufErgebnis = { gelaufen: boolean; belegt?: boolean; geprueft: number; belege: number; felder: number; fehler: string[]; offen: number; ergebnisse: Ergebnis[] }

async function arbeite(admin: Db, h: BelegHelfer, jetzt: Date, hoechstens: number, nurIds?: Set<string>): Promise<LaufErgebnis> {
  const ergebnis: LaufErgebnis = { gelaufen: true, geprueft: 0, belege: 0, felder: 0, fehler: [], offen: 0, ergebnisse: [] }
  const kandidaten = (await ladeVerbindlichkeiten(admin))
    .filter((v) => (!nurIds || nurIds.has(v.id)) && kommtDran(v, jetzt))
    .sort((a, b) => text(b.erstellt_am).localeCompare(text(a.erstellt_am)))
  ergebnis.offen = kandidaten.length
  for (const v of kandidaten.slice(0, hoechstens)) {
    // Eine Auslese mit PDF dauert etwa 5–20 Sekunden; nur beginnen, wenn genug Zeit bleibt.
    if (h.restMs && h.restMs() < 45_000) break
    ergebnis.geprueft++
    try {
      const e = await ergaenzeVerbindlichkeit(admin, v, h, jetzt)
      ergebnis.ergebnisse.push(e)
      if (e.beleg) ergebnis.belege++
      ergebnis.felder += e.felder.length
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err)
      ergebnis.fehler.push(`${text(v.lieferant) || v.id}: ${meldung}`)
      ergebnis.ergebnisse.push({ id: v.id, lieferant: text(v.lieferant), beleg: null, felder: [], art: null, fehler: meldung })
      await merkeFehler(admin, v, meldung, jetzt).catch(() => {})
    }
    ergebnis.offen--
  }
  return ergebnis
}

/** Vom Minuten-Zeitplan gerufen; arbeitet höchstens alle 2 Minuten und dann JE_LAUF Verbindlichkeiten. Wirft nie. */
export async function pruefeBelege(admin: Db, h: BelegHelfer, optionen: { jetzt?: Date; hoechstens?: number } = {}): Promise<LaufErgebnis> {
  const leer: LaufErgebnis = { gelaufen: false, geprueft: 0, belege: 0, felder: 0, fehler: [], offen: 0, ergebnisse: [] }
  const jetzt = optionen.jetzt ?? new Date()
  try {
    const anspruch = await beanspruche(admin, jetzt, false)
    if (anspruch !== 'ok') return { ...leer, belegt: anspruch === 'belegt' }
    try {
      return await arbeite(admin, h, jetzt, Math.max(1, optionen.hoechstens ?? JE_LAUF))
    } finally {
      await gebeFrei(admin, jetzt).catch(() => {})
    }
  } catch (err) {
    console.error('Belege ergänzen fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { ...leer, fehler: [err instanceof Error ? err.message : String(err)] }
  }
}

// ---------------------------------------------------------------------------------------------
// Vorschau (ohne KI, ohne Schreiben) und einmaliger Lauf (Geschäftsführung)

export type VorschauZeile = {
  id: string
  lieferant: string
  datum: string
  betrag: number | null
  fehlt: string[]
  kommtDran: boolean
  beleg: 'mail_anhang' | 'mail_text' | 'keiner'
  anhang?: string
  grund?: string
}

/** Was der Lauf täte — liest nur, ruft keine KI. Zählt auch vorher/nachher-relevante Lücken. */
export async function belegVorschau(admin: Db, jetzt = new Date()): Promise<{ gesamt: number; ohneBeleg: number; ohneBetrag: number; ungeprueft: number; kommtDran: number; zeilen: VorschauZeile[] }> {
  const alle = await ladeVerbindlichkeiten(admin)
  const zeilen: VorschauZeile[] = []
  for (const v of alle) {
    const angaben = angabenAusZeile(v as unknown as Record<string, unknown>)
    const luecken = belegLuecken(angaben, erkanntAus(v.automatisch_erkannt)).filter((l) => l.schwere === 'fehlt' || l.art === 'betrag_null' || l.art === 'netto')
    const dran = kommtDran(v, jetzt)
    let quelle: BelegQuelle = null
    let grund: string | undefined
    if (!text(v.quell_email_id).trim()) grund = 'keine Original-Mail (von Hand angelegt)'
    else if (dran) {
      const mail = await ladeMail(admin, text(v.quell_email_id))
      if (!mail) grund = 'Original-Mail nicht gefunden'
      else quelle = belegQuelle(v, mail)
    } else if (erkanntAus(v.automatisch_erkannt)?.stand) grund = 'schon automatisch bearbeitet'
    zeilen.push({
      id: v.id,
      lieferant: text(v.lieferant),
      datum: text(v.datum),
      betrag: zahl(v.betrag_brutto) ?? zahl(v.betrag_netto),
      fehlt: luecken.map((l) => l.text),
      kommtDran: dran,
      beleg: quelle?.art ?? 'keiner',
      ...(quelle?.art === 'mail_anhang' ? { anhang: text(quelle.anhang.filename) } : {}),
      ...(grund ? { grund } : {}),
    })
  }
  const zaehle = (p: (v: VerbZeile) => boolean) => alle.filter(p).length
  return {
    gesamt: alle.length,
    ohneBeleg: zaehle((v) => !hatBeleg(v)),
    ohneBetrag: zaehle((v) => !zahl(v.betrag_brutto) && !zahl(v.betrag_netto)),
    ungeprueft: zaehle((v) => v.quelle === 'email-automatisch' && v.geprueft !== true),
    kommtDran: zeilen.filter((z) => z.kommtDran).length,
    zeilen,
  }
}

/** Aktion "beleg_ergaenzen" (email-gateway): { schritt: 'vorschau' } oder { schritt: 'ausfuehren', ids?: [...] }. Nur Geschäftsführung. */
export async function belegErgaenzenAktion(
  admin: Db,
  aufrufer: { email: string; name: string; istGf: boolean },
  body: Record<string, unknown>,
  h: BelegHelfer,
): Promise<{ status: number; daten: Record<string, unknown> }> {
  if (!aufrufer.istGf) return { status: 403, daten: { error: 'Das Ergänzen der Belege kann nur die Geschäftsführung starten.' } }
  if (body.schritt !== 'ausfuehren') return { status: 200, daten: await belegVorschau(admin) }
  const ids = Array.isArray(body.ids) ? new Set(body.ids.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 500)) : undefined
  const jetzt = new Date()
  const anspruch = await beanspruche(admin, jetzt, true)
  if (anspruch !== 'ok') return { status: 409, daten: { error: 'Gerade läuft schon eine Ergänzung der Belege. Bitte in ein paar Minuten noch einmal versuchen.' } }
  try {
    const r = await arbeite(admin, h, jetzt, JE_AKTION, ids && ids.size ? ids : undefined)
    return { status: 200, daten: r as unknown as Record<string, unknown> }
  } finally {
    await gebeFrei(admin, jetzt).catch(() => {})
  }
}
