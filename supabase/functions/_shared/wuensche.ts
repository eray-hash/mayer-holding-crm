// Gemeinsame Helfer für die Tabelle `wuensche` (Wünsche und Probleme der Mitarbeiter mit dem CRM).
// Genutzt vom Assistenten (Werkzeug wunsch_notieren in telegram-gateway) und von der täglichen
// Auswertung (email-gateway/wunschAnalyse.ts). Geschrieben wird nur mit dem Dienst-Zugang.
//
// Ein Eintrag beschreibt eine FUNKTION des CRM, nie einen Kunden: keine Namen, Beträge, Adressen oder
// Inhalte aus Unterlagen. `entschaerfe` ist das Sicherheitsnetz dafür, falls doch etwas durchrutscht.
// Bewertet werden Funktionen, nie Personen.

// deno-lint-ignore no-explicit-any
type Db = any

export type WunschQuelle = 'assistent' | 'analyse' | 'fehler' | 'crm'
export type WunschStatus = 'neu' | 'geplant' | 'erledigt' | 'verworfen'

export type WunschZeile = {
  id: string
  quelle: WunschQuelle
  mitarbeiter: string | null
  titel: string
  beschreibung: string
  beleg: string | null
  status: WunschStatus
  anzahl: number
  erstellt_am: string
  zuletzt_am: string
  gemeldet_am: string | null
  notiz: string | null
}

/** Nur gegen diese Einträge wird zusammengeführt; Erledigtes oder Verworfenes, das wieder auftaucht, wird neu angelegt. */
export const OFFENE_STATUS: WunschStatus[] = ['neu', 'geplant']

/** Vergleichsform eines Titels: klein, ohne Umlaute, Satzzeichen und Vorsilben wie „Wunsch:“. */
export function normTitel(titel: string): string {
  return String(titel ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/^\s*(wunsch|idee|bitte|problem)\s*:\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function kuerze(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Entfernt, was nicht in einen Wunsch gehört: E-Mail-Adressen, Links, Telefon- und Kontonummern,
 *  Beträge, lange Zahlen und — falls übergeben — Namen von Kunden und Firmen. */
export function entschaerfe(text: string, namen: string[] = []): string {
  let t = String(text ?? '')
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[E-Mail]')
  t = t.replace(/https?:\/\/\S+/g, '[Link]')
  t = t.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g, '[Kontonummer]')
  t = t.replace(/(?:€\s?)?\d[\d.,' ]*\d\s?(?:€|EUR\b|Euro\b|Tsd\.?|Mio\.?)|€\s?\d[\d.,]*/gi, '[Betrag]')
  t = t.replace(/(?:\+|\b0)\d[\d /-]{6,}\d/g, '[Nummer]')
  t = t.replace(/\b\d{5,}\b/g, '[Nummer]')
  const sortiert = [...new Set(namen.map((n) => String(n ?? '').trim()).filter((n) => n.length >= 4))].sort((a, b) => b.length - a.length)
  for (const n of sortiert) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n)}(?![\\p{L}\\p{N}])`, 'giu'), '[Name]')
  return t
}

function namenListe(wert: string | null | undefined): string[] {
  return String(wert ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export type NeuerWunsch = {
  quelle: WunschQuelle
  /** Name oder Namen der Mitarbeiter, bei denen der Punkt vorkam. */
  mitarbeiter?: string | string[] | null
  titel: string
  beschreibung?: string
  beleg?: string | null
  /** Wie oft der Punkt in diesem Durchgang vorkam (Vorgabe 1). */
  anzahl?: number
}

export type GemerkterWunsch = { id: string; neu: boolean; anzahl: number; titel: string }

/** Legt einen Wunsch an oder zählt einen offenen Eintrag mit gleichem (normalisiertem) Titel hoch.
 *  `offene` darf übergeben werden, um bei mehreren Einträgen in Folge nicht jedes Mal neu zu lesen;
 *  die Liste wird dabei fortgeschrieben. Liefert null, wenn nichts geschrieben werden konnte. */
export async function merkeWunsch(db: Db, w: NeuerWunsch, jetzt = new Date(), offene?: WunschZeile[]): Promise<GemerkterWunsch | null> {
  const titel = kuerze(w.titel, 120)
  const schluessel = normTitel(titel)
  if (!schluessel) return null
  const jetztIso = jetzt.toISOString()
  const anzahl = Math.max(1, Math.round(Number(w.anzahl) || 1))
  let liste = offene
  if (!liste) {
    const { data, error } = await db.from('wuensche').select('*').in('status', OFFENE_STATUS)
    if (error) throw new Error(`Wünsche nicht lesbar: ${error.message}`)
    liste = (data ?? []) as WunschZeile[]
  }
  const vorhanden = liste.find((z) => OFFENE_STATUS.includes(z.status) && normTitel(z.titel) === schluessel)
  const wer = (Array.isArray(w.mitarbeiter) ? w.mitarbeiter : [w.mitarbeiter]).map((n) => String(n ?? '').trim()).filter(Boolean)
  if (vorhanden) {
    const namen = namenListe(vorhanden.mitarbeiter)
    for (const n of wer) if (!namen.includes(n)) namen.push(n)
    const aenderung: Partial<WunschZeile> = {
      anzahl: (Number(vorhanden.anzahl) || 0) + anzahl,
      zuletzt_am: jetztIso,
      mitarbeiter: namen.join(', ') || null,
      ...(w.beleg ? { beleg: kuerze(w.beleg, 240) } : {}),
      ...(!vorhanden.beschreibung && w.beschreibung ? { beschreibung: kuerze(w.beschreibung, 600) } : {}),
    }
    const { error } = await db.from('wuensche').update(aenderung).eq('id', vorhanden.id)
    if (error) throw new Error(`Wunsch nicht hochgezählt: ${error.message}`)
    Object.assign(vorhanden, aenderung)
    return { id: vorhanden.id, neu: false, anzahl: vorhanden.anzahl, titel: vorhanden.titel }
  }
  const zeile: WunschZeile = {
    id: `w_${crypto.randomUUID()}`,
    quelle: w.quelle,
    mitarbeiter: wer.join(', ') || null,
    titel,
    beschreibung: kuerze(w.beschreibung ?? '', 600),
    beleg: w.beleg ? kuerze(w.beleg, 240) : null,
    status: 'neu',
    anzahl,
    erstellt_am: jetztIso,
    zuletzt_am: jetztIso,
    gemeldet_am: null,
    notiz: null,
  }
  const { error } = await db.from('wuensche').insert(zeile)
  if (error) throw new Error(`Wunsch nicht gespeichert: ${error.message}`)
  liste.push(zeile)
  return { id: zeile.id, neu: true, anzahl, titel }
}
