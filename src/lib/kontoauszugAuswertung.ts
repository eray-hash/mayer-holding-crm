// Auswertung von Kontoauszügen in der Kundenakte — übernommen aus dem früheren Einzelprogramm
// „Kontoauszug → Excel“ (Kategorien, Summen je Kategorie und Monat, Monatsübersicht, Excel-Datei).
// Hier liegt nur Rechnen und Datei-Bauen ohne Bildschirm und ohne Datenbank, damit es sich ohne
// Browser prüfen lässt. Gespeichert wird in kontoauszugSpeicher.ts, angezeigt in KontoauszuegeSection.tsx.
//
// Zur Excel-Datei: Die Bibliothek „xlsx“ (freie Ausgabe) kann keine echten Excel-Pivottabellen anlegen,
// keine Schrift fett setzen und keine Zeilen fixieren. Das Blatt „Auswertung“ ist deshalb — genau wie im
// Einzelprogramm — eine fertig ausgerechnete Übersicht, keine Pivottabelle zum Umklappen.

import { utils, write } from 'xlsx'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import type { Dokument, KontoBuchung, KontoauszugDatei } from '../types'

// ---------- Kategorien ----------

export type Kontoart = 'privat' | 'geschaeft'

/** Die 26 Kategorien des Einzelprogramms. Zwei Namen sind eingedeutscht („Abos & Streaming“ und
 *  „Shopping & Bekleidung“); die alten Namen werden über KATEGORIE_ALT_NAMEN weiter erkannt. */
export const KATEGORIEN_PRIVAT = [
  'Einkommen & Gehalt',
  'Nebeneinkünfte & Erstattungen',
  'Miete & Wohnen',
  'Nebenkosten & Energie',
  'Lebensmittel & Supermarkt',
  'Drogerie & Gesundheit',
  'Restaurant, Café & Lieferdienst',
  'Mobilität & ÖPNV',
  'Auto & Tankstelle',
  'Reisen & Urlaub',
  'Versicherungen',
  'Abos & Mediendienste',
  'Telefon, Internet & Rundfunk',
  'Einkäufe & Bekleidung',
  'Elektronik & Haushalt',
  'Freizeit, Sport & Unterhaltung',
  'Bildung & Weiterbildung',
  'Kinder & Familie',
  'Bargeldabhebung',
  'Bankgebühren & Zinsen',
  'Steuern & Behörden',
  'Sparen, Anlage & Vorsorge',
  'Kredite & Finanzierung',
  'Spenden & Gemeinnütziges',
  'Umbuchung & Eigenübertrag',
  'Sonstiges',
] as const

/** Kategorien für Geschäftskonten (Firmen). „Umbuchung & Eigenübertrag“, „Versicherungen“,
 *  „Bankgebühren & Zinsen“ und „Sonstiges“ heißen bewusst wie bei Privatkonten. */
export const KATEGORIEN_GESCHAEFT = [
  'Umsatzerlöse',
  'Sonstige Erträge & Erstattungen',
  'Wareneinkauf & Material',
  'Personal & Löhne',
  'Miete & Raumkosten',
  'Energie & Nebenkosten',
  'Fahrzeuge',
  'Reisen & Bewirtung',
  'Versicherungen',
  'Telefon, Internet & Porto',
  'Bürobedarf',
  'Beratung & Dienstleister',
  'Werbung',
  'EDV & Programme',
  'Steuern & Abgaben',
  'Bankgebühren & Zinsen',
  'Investitionen',
  'Darlehen & Tilgung',
  'Privatentnahme & Privateinlage',
  'Umbuchung & Eigenübertrag',
  'Sonstiges',
] as const

export const AUFFANG_KATEGORIE = 'Sonstiges'

/** Zählt in der Monatsübersicht weder als Einnahme noch als Ausgabe (Geld zwischen eigenen Konten). */
export const UMBUCHUNGS_KATEGORIEN: readonly string[] = ['Umbuchung & Eigenübertrag']

/** Ältere oder abweichende Namen, die der Server liefern könnte → Name im CRM. */
const KATEGORIE_ALT_NAMEN: Record<string, string> = {
  'Abos & Streaming': 'Abos & Mediendienste',
  'Shopping & Bekleidung': 'Einkäufe & Bekleidung',
  Umbuchung: 'Umbuchung & Eigenübertrag',
  'Bank & Zinsen': 'Bankgebühren & Zinsen',
  'Wareneinkauf/Material': 'Wareneinkauf & Material',
  'Privatentnahme/-einlage': 'Privatentnahme & Privateinlage',
  Marketing: 'Werbung',
  'IT & Software': 'EDV & Programme',
}

export const KONTOART_LABEL: Record<Kontoart, string> = { privat: 'Privatkonto', geschaeft: 'Geschäftskonto' }

export function kategorienFuer(kontoart: Kontoart): readonly string[] {
  return kontoart === 'geschaeft' ? KATEGORIEN_GESCHAEFT : KATEGORIEN_PRIVAT
}

const REIHENFOLGE = new Map<string, number>([...KATEGORIEN_PRIVAT, ...KATEGORIEN_GESCHAEFT].map((k, i) => [k, i]))

/** Buchung, wie sie im CRM bearbeitet und gespeichert wird. `kategorieVorschlag` hält fest, was der
 *  Server vorgeschlagen hatte, wenn das nicht in den gewählten Kategoriensatz passte (dann steht die
 *  Buchung auf „Sonstiges“). Das Feld liegt mit in der jsonb-Spalte. */
export type Buchung = KontoBuchung & { kategorieVorschlag?: string }

/** Der Server kennt (Stand 18.11.2026) nur die Privatkategorien. Für Geschäftskonten werden sie hier
 *  übertragen, soweit das eindeutig ist; der Rest landet in „Sonstiges“ mit dem Servervorschlag als Hinweis. */
const PRIVAT_ZU_GESCHAEFT: Record<string, string> = {
  'Einkommen & Gehalt': 'Umsatzerlöse',
  'Nebeneinkünfte & Erstattungen': 'Sonstige Erträge & Erstattungen',
  'Miete & Wohnen': 'Miete & Raumkosten',
  'Nebenkosten & Energie': 'Energie & Nebenkosten',
  'Restaurant, Café & Lieferdienst': 'Reisen & Bewirtung',
  'Mobilität & ÖPNV': 'Reisen & Bewirtung',
  'Reisen & Urlaub': 'Reisen & Bewirtung',
  'Auto & Tankstelle': 'Fahrzeuge',
  'Telefon, Internet & Rundfunk': 'Telefon, Internet & Porto',
  'Steuern & Behörden': 'Steuern & Abgaben',
  'Kredite & Finanzierung': 'Darlehen & Tilgung',
}

/** Ordnet eine Kategorie dem gewählten Satz zu. `uebertragen`: aus einer Privatkategorie in die passende
 *  Geschäftskategorie umgesetzt. Unbekanntes landet in „Sonstiges“, mit dem Vorschlag als Hinweis. */
export function ordneKategorieZu(roh: unknown, kontoart: Kontoart): { kategorie: string; vorschlag?: string; uebertragen?: boolean } {
  const text = typeof roh === 'string' ? roh.trim() : ''
  if (!text) return { kategorie: AUFFANG_KATEGORIE }
  const name = KATEGORIE_ALT_NAMEN[text] ?? text
  if (kategorienFuer(kontoart).includes(name)) return { kategorie: name }
  if (kontoart === 'geschaeft') {
    const privatName = Object.entries(KATEGORIE_ALT_NAMEN).find(([, neu]) => neu === name)?.[0] ?? name
    const ziel = PRIVAT_ZU_GESCHAEFT[name] ?? PRIVAT_ZU_GESCHAEFT[privatName]
    if (ziel) return { kategorie: ziel, uebertragen: true }
  }
  return { kategorie: AUFFANG_KATEGORIE, vorschlag: name }
}

/** Welcher Kategoriensatz passt zu gespeicherten Buchungen? (Die Tabelle hat dafür keine eigene Spalte.) */
export function erkenneKontoart(buchungen: { kategorie: string }[]): Kontoart {
  const nurPrivat = new Set<string>(KATEGORIEN_PRIVAT.filter((k) => !(KATEGORIEN_GESCHAEFT as readonly string[]).includes(k)))
  const nurGeschaeft = new Set<string>(KATEGORIEN_GESCHAEFT.filter((k) => !(KATEGORIEN_PRIVAT as readonly string[]).includes(k)))
  let p = 0
  let g = 0
  for (const b of buchungen) {
    if (nurPrivat.has(b.kategorie)) p++
    else if (nurGeschaeft.has(b.kategorie)) g++
  }
  return g > p ? 'geschaeft' : 'privat'
}

// ---------- Übernahme der Server-Antwort ----------

let zaehler = 0
export function neueBuchungsId(): string {
  zaehler += 1
  return `bu_${Date.now().toString(36)}${zaehler.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function alsZahl(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') return leseBetrag(v) ?? 0
  return 0
}

function alsDatum(v: unknown): string {
  if (typeof v !== 'string') return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(v.trim())
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
  return ''
}

function alsText(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** Macht aus der Server-Antwort saubere Buchungen: Kategorie in den gewählten Satz, Zahlen als Zahl,
 *  Datum JJJJ-MM-TT, fehlende Kennungen ergänzt. `umgestellt` zählt die Buchungen, deren Kategorie
 *  auf „Sonstiges“ gesetzt werden musste. */
export function uebernehmeBuchungen(roh: unknown, kontoart: Kontoart, quelle: string): { buchungen: Buchung[]; umgestellt: number; uebertragen: number } {
  const liste = Array.isArray(roh) ? roh : []
  let umgestellt = 0
  let uebertragen = 0
  const buchungen: Buchung[] = []
  for (const r of liste) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const { kategorie, vorschlag, uebertragen: umgesetzt } = ordneKategorieZu(o.kategorie, kontoart)
    if (vorschlag) umgestellt++
    if (umgesetzt) uebertragen++
    const b: Buchung = {
      id: typeof o.id === 'string' && o.id ? o.id : neueBuchungsId(),
      datum: alsDatum(o.datum),
      wertstellung: alsDatum(o.wertstellung) || null,
      text: alsText(o.text),
      gegenpartei: alsText(o.gegenpartei) || null,
      betrag: Math.round(alsZahl(o.betrag) * 100) / 100,
      waehrung: (alsText(o.waehrung) || 'EUR').toUpperCase(),
      kategorie,
      konto: alsText(o.konto) || null,
      quelle: alsText(o.quelle) || quelle,
    }
    if (vorschlag) b.kategorieVorschlag = vorschlag
    buchungen.push(b)
  }
  return { buchungen, umgestellt, uebertragen }
}

/** Mehrere Lieferungen zusammenführen: Kennungen eindeutig machen, nach Datum sortieren. */
export function fuegeBuchungenZusammen(alt: Buchung[], neu: Buchung[]): Buchung[] {
  const ids = new Set(alt.map((b) => b.id))
  const ergaenzt = neu.map((b) => {
    if (!ids.has(b.id)) {
      ids.add(b.id)
      return b
    }
    const id = neueBuchungsId()
    ids.add(id)
    return { ...b, id }
  })
  return [...alt, ...ergaenzt].sort((a, b) => (a.datum || '9999').localeCompare(b.datum || '9999'))
}

// ---------- Zahlen und Daten ----------

/** Liest einen Betrag wie „-1.234,56“, „12,5“, „12.50“ oder „1 234,56 €“. Gibt null zurück, wenn nichts Lesbares darin steht. */
export function leseBetrag(eingabe: string): number | null {
  let t = eingabe.replace(/[\s€]/g, '').replace(/[−–]/g, '-')
  if (!t || t === '-' || t === '+') return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  if (!/^[+-]?\d*\.?\d*$/.test(t)) return null
  const n = parseFloat(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Betrag zum Eintippen: „-1234,56“ (ohne Tausenderpunkte, damit es sich leicht ändern lässt). */
export function betragAlsEingabe(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '0,00'
}

export function fmtBetrag(n: number, waehrung = 'EUR'): string {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: waehrung || 'EUR' }).format(n || 0)
  } catch {
    return `${(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${waehrung}`
  }
}

export function fmtTag(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–'
}

/** „JJJJ-MM“ aus einem Datum, sonst „Unbekannt“. */
export function monatSchluessel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[1]}-${m[2]}` : 'Unbekannt'
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function monatLabel(schluessel: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(schluessel)
  return m ? `${MONATE[Number(m[2]) - 1]} ${m[1]}` : schluessel
}

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Erster und letzter Buchungstag (JJJJ-MM-TT), leer wenn keine Daten. */
export function zeitraum(buchungen: { datum: string }[]): { von: string; bis: string } | null {
  const tage = buchungen.map((b) => b.datum).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  return tage.length ? { von: tage[0], bis: tage[tage.length - 1] } : null
}

export function zeitraumText(buchungen: { datum: string }[]): string {
  const z = zeitraum(buchungen)
  if (!z) return 'ohne Zeitraum'
  return z.von === z.bis ? fmtTag(z.von) : `${fmtTag(z.von)} – ${fmtTag(z.bis)}`
}

// ---------- Auswertung (wie aggregate.ts im Einzelprogramm) ----------

export type PivotZeile = { kategorie: string; jeMonat: Record<string, number>; summe: number }
export type MonatsZeile = { monat: string; einnahmen: number; ausgaben: number; saldo: number }
export type Auswertung = {
  monate: string[]
  pivot: PivotZeile[]
  /** Summen je Monat über alle Kategorien (inklusive Umbuchungen), wie die Gesamt-Zeile im Blatt „Auswertung“. */
  pivotSummen: Record<string, number>
  /** Summe aller Buchungen inklusive Umbuchungen. */
  pivotGesamt: number
  monatlich: MonatsZeile[]
  /** Ohne Umbuchungen. Ausgaben negativ. */
  summen: { einnahmen: number; ausgaben: number; saldo: number; anzahl: number }
  waehrung: string
}

export function werteAus(buchungen: KontoBuchung[]): Auswertung {
  const monatSet = new Set<string>()
  const jeKategorie = new Map<string, Map<string, number>>()
  const einnahmenJeMonat = new Map<string, number>()
  const ausgabenJeMonat = new Map<string, number>()
  let einnahmen = 0
  let ausgaben = 0

  for (const b of buchungen) {
    const m = monatSchluessel(b.datum)
    monatSet.add(m)
    const betrag = Number.isFinite(b.betrag) ? b.betrag : 0
    const kat = b.kategorie || AUFFANG_KATEGORIE
    const zeile = jeKategorie.get(kat) ?? new Map<string, number>()
    zeile.set(m, r2((zeile.get(m) ?? 0) + betrag))
    jeKategorie.set(kat, zeile)

    if (!UMBUCHUNGS_KATEGORIEN.includes(kat)) {
      if (betrag >= 0) {
        einnahmen += betrag
        einnahmenJeMonat.set(m, r2((einnahmenJeMonat.get(m) ?? 0) + betrag))
      } else {
        ausgaben += betrag
        ausgabenJeMonat.set(m, r2((ausgabenJeMonat.get(m) ?? 0) + betrag))
      }
    }
  }

  const monate = [...monatSet].sort((a, b) => (a === 'Unbekannt' ? 1 : b === 'Unbekannt' ? -1 : a.localeCompare(b)))

  const pivot: PivotZeile[] = [...jeKategorie.entries()]
    .map(([kategorie, werte]) => {
      const jeMonat: Record<string, number> = {}
      let summe = 0
      for (const m of monate) {
        const v = werte.get(m) ?? 0
        jeMonat[m] = v
        summe += v
      }
      return { kategorie, jeMonat, summe: r2(summe) }
    })
    // Ausgaben zuerst (größte zuerst), dann Einnahmen; bei gleicher Summe nach Kategorienliste.
    .sort((a, b) => {
      if (a.summe < 0 && b.summe >= 0) return -1
      if (a.summe >= 0 && b.summe < 0) return 1
      if (a.summe !== b.summe) return a.summe - b.summe
      return (REIHENFOLGE.get(a.kategorie) ?? 999) - (REIHENFOLGE.get(b.kategorie) ?? 999)
    })

  const pivotSummen: Record<string, number> = {}
  for (const m of monate) pivotSummen[m] = r2(pivot.reduce((s, z) => s + (z.jeMonat[m] ?? 0), 0))
  const pivotGesamt = r2(pivot.reduce((s, z) => s + z.summe, 0))

  const monatlich: MonatsZeile[] = monate.map((monat) => {
    const e = r2(einnahmenJeMonat.get(monat) ?? 0)
    const a = r2(ausgabenJeMonat.get(monat) ?? 0)
    return { monat, einnahmen: e, ausgaben: a, saldo: r2(e + a) }
  })

  return {
    monate,
    pivot,
    pivotSummen,
    pivotGesamt,
    monatlich,
    summen: { einnahmen: r2(einnahmen), ausgaben: r2(ausgaben), saldo: r2(einnahmen + ausgaben), anzahl: buchungen.length },
    waehrung: buchungen.find((b) => b.waehrung)?.waehrung?.toUpperCase() || 'EUR',
  }
}

// ---------- Dateien in der Akte ----------

const AUSWERTBAR_ENDUNG = /\.(pdf|png|jpe?g|webp|gif)$/i
const HEIC = /heic|heif/i

/** PDFs und Bilder mit hinterlegter Datei, die der Server lesen kann (HEIC-Fotos nicht). */
export function istAuswertbaresDokument(d: Pick<Dokument, 'name' | 'typ' | 'url'>): boolean {
  if (!d.url) return false
  const typ = (d.typ ?? '').toLowerCase()
  if (HEIC.test(typ) || /\.(heic|heif)$/i.test(d.name ?? '')) return false
  return typ.includes('pdf') || /^image\/(png|jpe?g|webp|gif)$/.test(typ) || AUSWERTBAR_ENDUNG.test(d.name ?? '')
}

/** Grenzen des Servers (kontoauszug_auslesen). */
export const PDF_HOECHSTENS = 20 * 1024 * 1024
export const FOTO_HOECHSTENS = 5 * 1024 * 1024
export const FOTO_KANTE = 2000

export function istPdf(d: { name: string; type?: string }): boolean {
  return /pdf/i.test(d.type ?? '') || /\.pdf$/i.test(d.name)
}

/** Prüft eine neu gewählte Datei vor dem Hochladen; gibt den Grund zurück, wenn sie nicht geht. */
export function pruefeNeueDatei(d: { name: string; type?: string; size: number }): string | null {
  if (istPdf(d)) return d.size > PDF_HOECHSTENS ? 'Das PDF ist größer als 20 MB. Bitte in kleinere Teile aufteilen (höchstens 24 Seiten je Datei).' : null
  if (/^image\//i.test(d.type ?? '') || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(d.name)) return null
  return 'Nur PDFs und Fotos lassen sich auslesen.'
}

const BANK_HINWEIS =
  /\b(konto ?auszu?e?g\w*|kontoauszuege?|auszu?e?g\w*|ums[aä]e?tz\w*|umsatz\w*|kontobewegung\w*|girokonto|finanzstatus|iban|de\d{2}( ?\d{4}){2,}|sparkasse\w*|kreissparkasse|stadtsparkasse|volksbank|raiffeisen\w*|vr ?bank|commerzbank|deutsche ?bank|postbank|hypovereinsbank|hvb|ing|ing ?diba|dkb|n26|comdirect|consorsbank|targobank|santander|sparda\w*|psd ?bank|norisbank|bw ?bank|bank|banking)\b/i

/** Klingt der Dateiname nach einem Kontoauszug? (für die Vorauswahl) */
export function klingtNachKontoauszug(name: string): boolean {
  const n = (name ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/[_\-.()[\]]+/g, ' ')
  return BANK_HINWEIS.test(n)
}

// ---------- Excel ----------

const GELD_FORMAT = '#,##0.00;[Red]-#,##0.00'
const DATUM_FORMAT = 'dd.mm.yyyy'
export const UMBUCHUNG_HINWEIS =
  'Ausgaben negativ, Einnahmen positiv. Die Kategorie „Umbuchung & Eigenübertrag“ zählt nicht in Einnahmen und Ausgaben der Monatsübersicht.'

/** Excel-Tageszahl (Tage seit 30.12.1899) für JJJJ-MM-TT, null bei ungültigem Datum. */
export function excelTag(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000)
}

function geld(v: number): CellObject {
  return { t: 'n', v: r2(v), z: GELD_FORMAT }
}

function datumZelle(iso: string | null | undefined): CellObject {
  const tag = excelTag(iso)
  return tag == null ? { t: 's', v: iso ?? '' } : { t: 'n', v: tag, z: DATUM_FORMAT }
}

function text(v: string | null | undefined): CellObject {
  return { t: 's', v: v ?? '' }
}

function blattAusZeilen(zeilen: CellObject[][], breiten: number[]): WorkSheet {
  const ws: WorkSheet = {}
  let maxSpalte = 0
  zeilen.forEach((zeile, r) => {
    zeile.forEach((zelle, c) => {
      ws[utils.encode_cell({ r, c })] = zelle
      maxSpalte = Math.max(maxSpalte, c)
    })
  })
  ws['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(zeilen.length - 1, 0), c: Math.max(maxSpalte, breiten.length - 1) } })
  ws['!cols'] = breiten.map((wch) => ({ wch }))
  return ws
}

function blattAuswertung(a: Auswertung): WorkSheet {
  const kopf: CellObject[] = [text('Kategorie'), ...a.monate.map((m) => text(monatLabel(m))), text('Gesamt')]
  const zeilen: CellObject[][] = [kopf]
  for (const z of a.pivot) zeilen.push([text(z.kategorie), ...a.monate.map((m) => geld(z.jeMonat[m] ?? 0)), geld(z.summe)])
  zeilen.push([text('Gesamt'), ...a.monate.map((m) => geld(a.pivotSummen[m] ?? 0)), geld(a.pivotGesamt)])
  zeilen.push([])
  zeilen.push([text(UMBUCHUNG_HINWEIS)])
  return blattAusZeilen(zeilen, [32, ...a.monate.map(() => 13), 15])
}

function blattMonate(a: Auswertung): WorkSheet {
  const zeilen: CellObject[][] = [[text('Monat'), text('Einnahmen'), text('Ausgaben'), text('Saldo')]]
  for (const m of a.monatlich) zeilen.push([text(monatLabel(m.monat)), geld(m.einnahmen), geld(m.ausgaben), geld(m.saldo)])
  zeilen.push([text('Gesamt'), geld(a.summen.einnahmen), geld(a.summen.ausgaben), geld(a.summen.saldo)])
  zeilen.push([])
  zeilen.push([text('Ohne „Umbuchung & Eigenübertrag“. Ausgaben negativ.')])
  return blattAusZeilen(zeilen, [16, 16, 16, 16])
}

export const TRANSAKTIONEN_KOPF = ['Datum', 'Wertstellung', 'Empfänger / Auftraggeber', 'Buchungstext', 'Kategorie', 'Betrag', 'Währung', 'Konto / IBAN', 'Quelldatei']

function blattTransaktionen(buchungen: KontoBuchung[]): WorkSheet {
  const sortiert = [...buchungen].sort((a, b) => (a.datum || '9999').localeCompare(b.datum || '9999'))
  const zeilen: CellObject[][] = [TRANSAKTIONEN_KOPF.map(text)]
  for (const b of sortiert) {
    zeilen.push([
      datumZelle(b.datum),
      b.wertstellung ? datumZelle(b.wertstellung) : text(''),
      text(b.gegenpartei),
      text(b.text),
      text(b.kategorie),
      geld(b.betrag),
      text(b.waehrung || 'EUR'),
      text(b.konto),
      text(b.quelle),
    ])
  }
  const ws = blattAusZeilen(zeilen, [12, 13, 30, 44, 30, 14, 9, 26, 28])
  ws['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(zeilen.length - 1, 0), c: TRANSAKTIONEN_KOPF.length - 1 } }) }
  return ws
}

function blattInfo(a: Auswertung, dateien: KontoauszugDatei[], meta: { titel: string; erstelltAm: Date }): WorkSheet {
  const z = a.monate.filter((m) => m !== 'Unbekannt')
  const zeilen: CellObject[][] = [
    [text('Titel'), text(meta.titel)],
    [text('Erstellt am'), text(meta.erstelltAm.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))],
    [text('Buchungen gesamt'), { t: 'n', v: a.summen.anzahl }],
    [text('Zeitraum'), text(z.length ? `${monatLabel(z[0])} – ${monatLabel(z[z.length - 1])}` : '–')],
    [text('Einnahmen gesamt'), geld(a.summen.einnahmen)],
    [text('Ausgaben gesamt'), geld(a.summen.ausgaben)],
    [text('Saldo'), geld(a.summen.saldo)],
    [text('Währung'), text(a.waehrung)],
    [],
    [text('Ausgewertete Dateien')],
  ]
  for (const d of dateien) {
    const teile = d.fehler
      ? [`Fehler: ${d.fehler}`]
      : [`${d.anzahl} Buchungen`, d.bank ?? '', d.iban ?? '', d.von || d.bis ? `${fmtTag(d.von)} bis ${fmtTag(d.bis)}` : ''].filter(Boolean)
    zeilen.push([text(d.name), text(teile.join(' · '))])
  }
  zeilen.push([])
  zeilen.push([text('Hinweis'), text('Auswertung ohne Gewähr. Beträge und Kategorien vor Verwendung prüfen.')])
  return blattAusZeilen(zeilen, [28, 70])
}

/** Die Excel-Datei wie im Einzelprogramm: „Auswertung“ (Kategorie × Monat), „Monatsübersicht“,
 *  „Transaktionen“ (mit Filter in der Kopfzeile) und „Info“. */
export function baueArbeitsmappe(buchungen: KontoBuchung[], dateien: KontoauszugDatei[], meta: { titel: string; erstelltAm?: Date }): WorkBook {
  const a = werteAus(buchungen)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, blattAuswertung(a), 'Auswertung')
  utils.book_append_sheet(wb, blattMonate(a), 'Monatsübersicht')
  utils.book_append_sheet(wb, blattTransaktionen(buchungen), 'Transaktionen')
  utils.book_append_sheet(wb, blattInfo(a, dateien, { titel: meta.titel, erstelltAm: meta.erstelltAm ?? new Date() }), 'Info')
  wb.Props = { Title: meta.titel, Author: 'Mayer Holding CRM' }
  return wb
}

export function arbeitsmappeAlsBytes(wb: WorkBook): ArrayBuffer {
  return write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
}

export function excelDateiname(titel: string, tag: string): string {
  // Nur einfache Zeichen: Der Name wird auch Teil des Speicherpfads in der Akte.
  const sauber = (titel || 'Kontoauszug')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[–—]/g, '-')
    .replace(/[^A-Za-z0-9.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)
  return `Auswertung_${sauber}_${tag}.xlsx`
}

export const EXCEL_TYP = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
