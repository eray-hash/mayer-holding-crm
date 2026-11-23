// Gesprächs-App „Mayer Gespräch“: Typen der Tabelle gespraech_aufnahmen und des Auswertungs-Schemas
// (Spalte `analyse`) samt Prüf- und Aufräumfunktion. Reiner Code ohne Deno- oder Netzbezug — der Server
// (email-gateway/gespraechPipeline.ts) und die App (src/gespraech/**) dürfen beide von hier importieren.
//
// Regel der Auswertung: nur aus dem Gesagten, nichts erfinden — leere Listen statt Vermutungen. Die
// Aufräumfunktion setzt das technisch durch: leere Einträge fliegen raus, Listen werden gekürzt, Daten
// werden ins Format JJJJ-MM-TT gebracht (unlesbare Daten entfallen statt geraten zu werden).

// ---------- Tabelle ----------

export const GESPRAECH_ARTEN = ['termin', 'telefon', 'notiz'] as const
export type GespraechArt = (typeof GESPRAECH_ARTEN)[number]

export const GESPRAECH_STATUS = ['aufnahme', 'hochladen', 'transkription', 'analyse', 'fertig', 'fehler', 'verworfen'] as const
export type GespraechStatus = (typeof GESPRAECH_STATUS)[number]

export type SegmentStatus = 'offen' | 'hochgeladen' | 'transkribiert' | 'fehler'

/** Ein Tonabschnitt der Aufnahme (die App nimmt in Abschnitten auf und lädt jeden einzeln hoch). */
export type GespraechSegment = {
  nr: number
  pfad: string
  mime: string
  dauer_s?: number
  bytes?: number
  status: SegmentStatus
  /** Abschrift dieses Abschnitts (leer bei Stille). */
  text?: string
  /** Zeitmarken der Spracherkennung innerhalb des Abschnitts: Sekunde ab Abschnittsbeginn + Text. */
  stuecke?: { ab: number; text: string }[]
  /** Von der Spracherkennung gemeldete Sprache dieses Abschnitts (Kürzel wie de, tr, en). */
  sprache?: string
  /** Nur Server: Beginn der laufenden Abschrift (Sperre), Zahl der Versuche, letzter Fehler. */
  seit?: string | null
  versuche?: number
  letzter_versuch?: string | null
  fehler?: string | null
  /** Nur Server: Mengengrenze des Abschrift-Dienstes (429) — so oft schon vertröstet, frühestens dann wieder. */
  mengengrenze?: number
  naechster_versuch?: string | null
}

export type GespraechMarker = { sek: number; text: string; art: 'wichtig' | 'aufgabe' | 'frage' }
export type GespraechFoto = { pfad: string; name: string; sek?: number }
export type GespraechEinwilligung = { bestaetigt: boolean; am: string; text: string; wer?: string }

/** Ein Absatz der Abschrift mit Sprecher (Spalte `sprecher`). `sek` = ungefährer Beginn in der Aufnahme. */
export type GespraechAbsatz = { label: string; name?: string; rolle?: SprecherRolle; sek: number; text: string }

export type GespraechAufnahme = {
  id: string
  mitarbeiter_email: string
  kunde_id: string | null
  kunde_bereich: string | null
  objekt_id: string | null
  termin_id: string | null
  titel: string | null
  art: GespraechArt
  status: GespraechStatus
  fehler: string | null
  segmente: GespraechSegment[]
  marker: GespraechMarker[]
  notizen: string | null
  fotos: GespraechFoto[]
  einwilligung: GespraechEinwilligung | null
  transkript: string | null
  sprecher: GespraechAbsatz[] | null
  analyse: GespraechAnalyse | null
  uebernommen: Record<string, unknown> | null
  dauer_s: number | null
  erstellt_am: string
  geaendert_am: string | null
  aufbewahren_bis: string | null
  /** Zusätzlich zum Vertrag: wann das Audio gelöscht wurde (Frist oder Verwerfen). */
  audio_geloescht_am?: string | null
  abgeschlossen_am?: string | null
  /** Sprache der Aufnahme laut Einstellung (Schlüssel aus SPRACHEN, Standard „deutsch“). Seit Runde 5. */
  sprache?: GespraechSprache | null
  /** Erkannte Hauptsprache der Abschrift (Kürzel wie de, tr, en), gesetzt bei der Auswertung. */
  sprache_erkannt?: string | null
  /** Zwischenspeicher der Übersetzungen (nur auf Anforderung, siehe gespraech_uebersetzen). */
  uebersetzung?: GespraechUebersetzung | null
  /** Wer die Aufnahme geteilt bekommen hat (Kollegen per Telegram, Gesprächsnotiz an den Kunden). */
  geteilt?: GespraechGeteilt[] | null
}

/** Zwischenspeicher der Übersetzungen einer Aufnahme (Spalte uebersetzung). */
export type GespraechUebersetzung = {
  /** Deutsche Fassung der Abschrift, Absatz für Absatz wie Spalte sprecher; `quelle` = Zahl der Absätze beim Übersetzen. */
  abschrift?: { absaetze: string[]; quelle: number; fertig: boolean; am: string }
  /** Mail-Entwurf bzw. Gesprächsnotiz in der Sprache des Kunden; `schluessel` = Prüfsumme des deutschen Textes. */
  mail?: { sprache: string; schluessel: string; betreff: string; text: string; am: string }
  notiz?: { sprache: string; schluessel: string; betreff: string; text: string; am: string }
}

export type GespraechGeteilt =
  | { art: 'kollege'; an: string; name: string; am: string; von: string; ok: boolean }
  | { art: 'kunde'; an: string; betreff: string; am: string; von: string; sprache?: string }

// ---------- Sprachen ----------

/**
 * Wählbare Sprachen einer Aufnahme. `code` geht an die Spracherkennung (Whisper); „automatisch“ lässt die
 * Spracherkennung selbst entscheiden. Auswertung, Protokoll und Mail-Entwurf sind immer Deutsch.
 */
export const SPRACHEN = [
  { schluessel: 'deutsch', name: 'Deutsch', code: 'de' },
  { schluessel: 'automatisch', name: 'Automatisch erkennen', code: null },
  { schluessel: 'tuerkisch', name: 'Türkisch', code: 'tr' },
  { schluessel: 'englisch', name: 'Englisch', code: 'en' },
  { schluessel: 'arabisch', name: 'Arabisch', code: 'ar' },
  { schluessel: 'russisch', name: 'Russisch', code: 'ru' },
  { schluessel: 'polnisch', name: 'Polnisch', code: 'pl' },
  { schluessel: 'rumaenisch', name: 'Rumänisch', code: 'ro' },
  { schluessel: 'italienisch', name: 'Italienisch', code: 'it' },
  { schluessel: 'franzoesisch', name: 'Französisch', code: 'fr' },
  { schluessel: 'spanisch', name: 'Spanisch', code: 'es' },
  { schluessel: 'kroatisch', name: 'Kroatisch', code: 'hr' },
  { schluessel: 'serbisch', name: 'Serbisch', code: 'sr' },
  { schluessel: 'bosnisch', name: 'Bosnisch', code: 'bs' },
  { schluessel: 'albanisch', name: 'Albanisch', code: 'sq' },
  { schluessel: 'griechisch', name: 'Griechisch', code: 'el' },
  { schluessel: 'persisch', name: 'Persisch', code: 'fa' },
  { schluessel: 'ukrainisch', name: 'Ukrainisch', code: 'uk' },
  { schluessel: 'bulgarisch', name: 'Bulgarisch', code: 'bg' },
  { schluessel: 'ungarisch', name: 'Ungarisch', code: 'hu' },
  { schluessel: 'portugiesisch', name: 'Portugiesisch', code: 'pt' },
  { schluessel: 'niederlaendisch', name: 'Niederländisch', code: 'nl' },
] as const
export type GespraechSprache = (typeof SPRACHEN)[number]['schluessel']

// Namen, die die Spracherkennung zurückmeldet (Groq/OpenAI: englische Namen wie „turkish“), → Kürzel.
const ERKANNT_NAME: Record<string, string> = {
  german: 'de', turkish: 'tr', english: 'en', arabic: 'ar', russian: 'ru', polish: 'pl', romanian: 'ro', moldavian: 'ro', moldovan: 'ro',
  italian: 'it', french: 'fr', spanish: 'es', castilian: 'es', croatian: 'hr', serbian: 'sr', bosnian: 'bs', albanian: 'sq', greek: 'el',
  persian: 'fa', ukrainian: 'uk', bulgarian: 'bg', hungarian: 'hu', portuguese: 'pt', dutch: 'nl', flemish: 'nl', kurdish: 'ku',
  azerbaijani: 'az', macedonian: 'mk', slovenian: 'sl', slovak: 'sk', czech: 'cs', vietnamese: 'vi', chinese: 'zh', farsi: 'fa',
}
const SPRACH_NAME_DE: Record<string, string> = Object.fromEntries([
  ...SPRACHEN.filter((s) => s.code).map((s) => [s.code as string, s.name]),
  ['ku', 'Kurdisch'], ['az', 'Aserbaidschanisch'], ['mk', 'Mazedonisch'], ['sl', 'Slowenisch'], ['sk', 'Slowakisch'], ['cs', 'Tschechisch'],
  ['vi', 'Vietnamesisch'], ['zh', 'Chinesisch'],
])

/** Einstellung der App (auch „türkisch“, „Türkisch“, „tr“) → Schlüssel aus SPRACHEN; Unbekanntes → „deutsch“. */
export function normalisiereSprachwahl(x: unknown): GespraechSprache {
  const t = typeof x === 'string' ? x.trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss') : ''
  if (!t) return 'deutsch'
  if (t === 'auto' || t === 'automatisch erkennen') return 'automatisch'
  const treffer = SPRACHEN.find((s) => s.schluessel === t || s.code === t || s.name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue') === t)
  return treffer ? treffer.schluessel : 'deutsch'
}

/** Kürzel für die Spracherkennung; null = automatisch erkennen lassen. */
export function whisperSprache(wahl: unknown): string | null {
  const s = normalisiereSprachwahl(wahl)
  return SPRACHEN.find((x) => x.schluessel === s)?.code ?? null
}

/** Von der Spracherkennung gemeldete Sprache („Turkish“, „turkish“, „tr“) → Kürzel; sonst null. */
export function spracheAusErkennung(x: unknown): string | null {
  const t = typeof x === 'string' ? x.trim().toLowerCase() : ''
  if (!t) return null
  if (/^[a-z]{2}$/.test(t)) return t
  return ERKANNT_NAME[t] ?? null
}

/** Deutscher Name einer Sprache zum Kürzel („tr“ → „Türkisch“); unbekannt → das Kürzel in Großbuchstaben. */
export function sprachName(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toLowerCase() : ''
  if (!c) return ''
  return SPRACH_NAME_DE[c] ?? c.toUpperCase()
}

/** Hauptsprache einer Aufnahme: die Sprache mit dem meisten abgeschriebenen Text (Abschnitte ohne Angabe zählen
 *  zur Vorgabe `ohneAngabe`, z. B. „de“ bei Einstellung Deutsch). Ohne Text: die Vorgabe. */
export function hauptsprache(segmente: { sprache?: string; text?: string; status?: string }[], ohneAngabe: string | null): string | null {
  const summe = new Map<string, number>()
  for (const s of segmente) {
    const laenge = String(s.text ?? '').trim().length
    const code = spracheAusErkennung(s.sprache) ?? ohneAngabe
    if (!laenge || !code) continue
    summe.set(code, (summe.get(code) ?? 0) + laenge)
  }
  let beste: string | null = null
  let max = 0
  for (const [c, n] of summe) if (n > max) [beste, max] = [c, n]
  return beste ?? ohneAngabe
}

// ---------- Auswertungs-Schema ----------

export const STAMMDATEN_FELDER = ['telefon', 'email', 'anschrift', 'firma', 'ansprechpartner', 'sonstiges'] as const
export type StammdatenFeld = (typeof STAMMDATEN_FELDER)[number]
export const SPRECHER_ROLLEN = ['mitarbeiter', 'kunde', 'sonstige'] as const
export type SprecherRolle = (typeof SPRECHER_ROLLEN)[number]

export type GespraechAnalyse = {
  zusammenfassung: string
  kernthemen: string[]
  vereinbarungen: string[]
  offene_punkte: string[]
  naechste_schritte: { text: string; faellig?: string; wer?: string }[]
  termine: { titel: string; datum: string; uhrzeit?: string; ort?: string; mit?: string }[]
  todos: { text: string; faellig?: string; zustaendig?: string }[]
  wiedervorlagen: { titel: string; faellig: string }[]
  zahlen: { was: string; betrag: number; einheit?: string }[]
  kundenfragen: string[]
  einwaende: string[]
  stimmung: string
  risiken: string[]
  stammdaten: { feld: StammdatenFeld; wert: string }[]
  unterlagen_fehlen: string[]
  mail_entwurf: { betreff: string; text: string }
  sprecher: { label: string; name?: string; rolle?: SprecherRolle }[]
  chance_hinweis?: { prozent?: number; begruendung: string }
  /** Antworten auf den Fragebogen des Bereichs (Vorlage fragebogen_vorlage), nur aus dem Gesagten. Seit Runde 5. */
  fragebogen?: FragebogenAntwort[]
  fragebogen_vorlage?: { id: string; name: string }
  /** Vorschläge für die Felder der Projekt-Checkliste der Akte (nur Gesagtes; übernommen wird nur in leere Felder). */
  aktenfelder?: Aktenfelder
}

export type FragebogenAntwort = { frage: string; antwort: string; sicher: boolean }
export type Aktenfelder = { sachverhalt?: string; branche?: string; dienstleistungen?: string[] }
export const AKTENFELDER = ['sachverhalt', 'branche', 'dienstleistungen'] as const
export type AktenfeldName = (typeof AKTENFELDER)[number]

/** Höchstzahl je Liste — mehr ist bei einem Gespräch nie sinnvoll und bläht nur die Prüfansicht auf. */
export const LISTEN_GRENZE = 25
/** Höchstzahl der Fragen eines Fragebogens (der Erben-Fragebogen hat über 100). */
export const FRAGEBOGEN_GRENZE = 200

export function leereAnalyse(): GespraechAnalyse {
  return {
    zusammenfassung: '',
    kernthemen: [],
    vereinbarungen: [],
    offene_punkte: [],
    naechste_schritte: [],
    termine: [],
    todos: [],
    wiedervorlagen: [],
    zahlen: [],
    kundenfragen: [],
    einwaende: [],
    stimmung: '',
    risiken: [],
    stammdaten: [],
    unterlagen_fehlen: [],
    mail_entwurf: { betreff: '', text: '' },
    sprecher: [],
  }
}

// ---------- Hilfen ----------

function text(x: unknown, max = 500): string {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x)
  if (typeof x !== 'string') return ''
  const t = x.replace(/\s+/g, ' ').trim()
  // „unbekannt“, „-“, „n/a“ & Co. zählen als leer (das Modell soll weglassen, nicht platzhalten).
  if (/^(-+|–|—|\?+|unbekannt|keine angabe|nicht genannt|k\.\s?a\.|n\/a|null|undefined|none)$/i.test(t)) return ''
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

/** Mehrzeiliger Text (Zusammenfassung, Mail): Zeilenumbrüche bleiben, Leerraum wird geglättet. */
function langtext(x: unknown, max: number): string {
  if (typeof x !== 'string') return ''
  const t = x.replace(/\r\n?/g, '\n').split('\n').map((z) => z.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

function liste(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

function textListe(x: unknown, max = 300): string[] {
  const gesehen = new Set<string>()
  const aus: string[] = []
  for (const e of liste(x)) {
    const t = text(typeof e === 'object' && e !== null && 'text' in e ? (e as { text: unknown }).text : e, max)
    const schluessel = t.toLowerCase()
    if (!t || gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    aus.push(t)
    if (aus.length >= LISTEN_GRENZE) break
  }
  return aus
}

function objektListe<T>(x: unknown, form: (o: Record<string, unknown>) => T | null, schluessel: (t: T) => string): T[] {
  const gesehen = new Set<string>()
  const aus: T[] = []
  for (const e of liste(x)) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue
    const t = form(e as Record<string, unknown>)
    if (!t) continue
    const s = schluessel(t).toLowerCase()
    if (gesehen.has(s)) continue
    gesehen.add(s)
    aus.push(t)
    if (aus.length >= LISTEN_GRENZE) break
  }
  return aus
}

function gueltigesDatum(j: number, m: number, t: number): string | null {
  if (j < 2000 || j > 2100 || m < 1 || m > 12 || t < 1 || t > 31) return null
  const d = new Date(Date.UTC(j, m - 1, t))
  if (d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) return null
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`
}

/**
 * Bringt ein Datum ins Format JJJJ-MM-TT. Versteht 2026-11-24, 2026-11-24T10:00…, 24.11.2026, 24.11.26 und
 * 24.11. (ohne Jahr: das nächste solche Datum ab `bezug`, höchstens 30 Tage zurück). Sonst null — geraten wird nicht.
 */
export function isoDatum(x: unknown, bezug?: string): string | null {
  const s = typeof x === 'string' ? x.trim() : ''
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s)
  if (m) return gueltigesDatum(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})?$/.exec(s)
  if (m) {
    const t = +m[1]
    const mo = +m[2]
    if (m[3]) return gueltigesDatum(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, t)
    const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(bezug ?? '')
    if (!b) return null
    const bezugTag = Date.UTC(+b[1], +b[2] - 1, +b[3])
    for (const j of [+b[1], +b[1] + 1]) {
      const d = gueltigesDatum(j, mo, t)
      if (d && Date.parse(d) >= bezugTag - 30 * 86400e3) return d
    }
    return null
  }
  return null
}

/** Uhrzeit als HH:MM (versteht 9, 9:30, 9.30, 09:30 Uhr, 14h). Sonst null. */
export function uhrzeit(x: unknown): string | null {
  const s = typeof x === 'string' ? x.trim().toLowerCase() : typeof x === 'number' ? String(x) : ''
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)?$/.exec(s)
  if (!m) return null
  const h = +m[1]
  const mi = m[2] ? +m[2] : 0
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/** Betrag als Zahl: 1200, "1.200,50", "1,2 Mio", "250 Tsd.", "3 %" → Zahl; sonst null. */
export function betrag(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x !== 'string') return null
  let s = x.trim().toLowerCase().replace(/€|eur(o)?|%|prozent/g, '').trim()
  let faktor = 1
  if (/(mio\.?|millionen?)$/.test(s)) faktor = 1e6
  else if (/(tsd\.?|tausend|k)$/.test(s)) faktor = 1e3
  else if (/(mrd\.?|milliarden?)$/.test(s)) faktor = 1e9
  s = s.replace(/(mio\.?|millionen?|tsd\.?|tausend|k|mrd\.?|milliarden?)$/, '').trim()
  if (!/^-?[\d.,\s]+$/.test(s)) return null
  s = s.replace(/\s/g, '')
  // Deutsches Format: Punkt = Tausender, Komma = Dezimal. „1.200“ ist 1200, „1,5“ ist 1,5.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * faktor * 100) / 100 : null
}

function rolle(x: unknown): SprecherRolle | undefined {
  const t = text(x, 40).toLowerCase()
  if (!t) return undefined
  if ((SPRECHER_ROLLEN as readonly string[]).includes(t)) return t as SprecherRolle
  if (/mitarbeit|berater|makler|mayer/.test(t)) return 'mitarbeiter'
  if (/kund|interessent|mandant|käufer|verkäufer|eigentümer/.test(t)) return 'kunde'
  return 'sonstige'
}

function ohneLeere<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]
  return o
}

// ---------- Prüfen und aufräumen ----------

/**
 * Prüft und räumt eine Auswertung auf (Antwort des Modells oder Bearbeitung in der App): fehlende Felder
 * werden leer ergänzt, unbekannte entfernt, Listen auf LISTEN_GRENZE gekürzt, doppelte und leere Einträge
 * entfernt, Daten als JJJJ-MM-TT (Einträge, die ohne Datum sinnlos sind — Termine, Wiedervorlagen —, entfallen),
 * Uhrzeiten als HH:MM, Beträge als Zahl. `bezug` (JJJJ-MM-TT, Tag des Gesprächs) löst Daten ohne Jahr auf.
 */
export function normalisiereAnalyse(roh: unknown, bezug?: string): GespraechAnalyse {
  const r = (roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}) as Record<string, unknown>
  const datum = (x: unknown) => isoDatum(x, bezug) ?? undefined
  const aus: GespraechAnalyse = {
    zusammenfassung: langtext(r.zusammenfassung, 3000),
    kernthemen: textListe(r.kernthemen, 200),
    vereinbarungen: textListe(r.vereinbarungen),
    offene_punkte: textListe(r.offene_punkte),
    naechste_schritte: objektListe(r.naechste_schritte, (o) => {
      const t = text(o.text)
      return t ? ohneLeere({ text: t, faellig: datum(o.faellig), wer: text(o.wer, 100) || undefined }) : null
    }, (x) => x.text),
    termine: objektListe(r.termine, (o) => {
      const titel = text(o.titel, 200)
      const d = datum(o.datum)
      if (!titel || !d) return null
      return ohneLeere({ titel, datum: d, uhrzeit: uhrzeit(o.uhrzeit) ?? undefined, ort: text(o.ort, 200) || undefined, mit: text(o.mit, 200) || undefined })
    }, (x) => `${x.titel}|${x.datum}|${x.uhrzeit ?? ''}`),
    todos: objektListe(r.todos, (o) => {
      const t = text(o.text)
      return t ? ohneLeere({ text: t, faellig: datum(o.faellig), zustaendig: text(o.zustaendig, 100) || undefined }) : null
    }, (x) => x.text),
    wiedervorlagen: objektListe(r.wiedervorlagen, (o) => {
      const titel = text(o.titel, 200)
      const d = datum(o.faellig)
      return titel && d ? { titel, faellig: d } : null
    }, (x) => `${x.titel}|${x.faellig}`),
    zahlen: objektListe(r.zahlen, (o) => {
      const was = text(o.was, 200)
      const b = betrag(o.betrag)
      if (!was || b === null) return null
      let einheit = text(o.einheit, 30)
      if (!einheit && typeof o.betrag === 'string') einheit = /%|prozent/i.test(o.betrag) ? '%' : /€|eur/i.test(o.betrag) ? '€' : ''
      return ohneLeere({ was, betrag: b, einheit: einheit || undefined })
    }, (x) => `${x.was}|${x.betrag}`),
    kundenfragen: textListe(r.kundenfragen),
    einwaende: textListe(r.einwaende),
    stimmung: text(r.stimmung, 300),
    risiken: textListe(r.risiken),
    stammdaten: objektListe(r.stammdaten, (o) => {
      const wert = text(o.wert, 300)
      if (!wert) return null
      const f = text(o.feld, 40).toLowerCase()
      const feld = ((STAMMDATEN_FELDER as readonly string[]).includes(f) ? f : f === 'adresse' ? 'anschrift' : f === 'e-mail' || f === 'mail' ? 'email' : 'sonstiges') as StammdatenFeld
      return { feld, wert }
    }, (x) => `${x.feld}|${x.wert}`),
    unterlagen_fehlen: textListe(r.unterlagen_fehlen),
    mail_entwurf: (() => {
      const m = (r.mail_entwurf && typeof r.mail_entwurf === 'object' ? r.mail_entwurf : {}) as Record<string, unknown>
      const betreff = text(m.betreff, 200)
      const t = langtext(m.text, 6000)
      return t ? { betreff, text: t } : { betreff: '', text: '' }
    })(),
    sprecher: objektListe(r.sprecher, (o) => {
      const label = text(o.label, 60)
      return label ? ohneLeere({ label, name: text(o.name, 120) || undefined, rolle: rolle(o.rolle) }) : null
    }, (x) => x.label),
  }
  const c = r.chance_hinweis && typeof r.chance_hinweis === 'object' ? (r.chance_hinweis as Record<string, unknown>) : null
  const begruendung = c ? text(c.begruendung, 600) : ''
  if (c && begruendung) {
    const p = typeof c.prozent === 'number' ? c.prozent : betrag(c.prozent)
    aus.chance_hinweis = p === null || p === undefined || !Number.isFinite(p) ? { begruendung } : { prozent: Math.max(0, Math.min(100, Math.round(p))), begruendung }
  }
  // Fragebogen und Aktenfelder: nur, wenn etwas da ist (ältere Auswertungen bleiben unverändert).
  const fragebogen = normalisiereFragebogen(r.fragebogen)
  if (fragebogen.length) {
    aus.fragebogen = fragebogen
    const v = r.fragebogen_vorlage && typeof r.fragebogen_vorlage === 'object' ? (r.fragebogen_vorlage as Record<string, unknown>) : null
    const vid = v ? text(v.id, 80) : ''
    if (vid) aus.fragebogen_vorlage = { id: vid, name: text(v!.name, 200) }
  }
  const felder = normalisiereAktenfelder(r.aktenfelder)
  if (Object.keys(felder).length) aus.aktenfelder = felder
  return aus
}

/** Antworten auf einen Fragebogen: Frage und Antwort Pflicht, `sicher` nur bei ausdrücklichem true, je Frage einmal. */
export function normalisiereFragebogen(x: unknown): FragebogenAntwort[] {
  const gesehen = new Set<string>()
  const aus: FragebogenAntwort[] = []
  for (const e of liste(x)) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue
    const o = e as Record<string, unknown>
    const frage = text(o.frage, 300)
    const antwort = text(o.antwort, 800)
    if (!frage || !antwort) continue
    const s = frage.toLowerCase()
    if (gesehen.has(s)) continue
    gesehen.add(s)
    aus.push({ frage, antwort, sicher: o.sicher === true })
    if (aus.length >= FRAGEBOGEN_GRENZE) break
  }
  return aus
}

/** Vorschläge für die Aktenfelder: Sachverhalt (mehrzeilig, kurz), Branche, Dienstleistungen (Liste). Leeres entfällt. */
export function normalisiereAktenfelder(x: unknown): Aktenfelder {
  const o = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>
  const aus: Aktenfelder = {}
  const sachverhalt = langtext(o.sachverhalt, 1500)
  if (sachverhalt && text(sachverhalt)) aus.sachverhalt = sachverhalt
  const branche = text(o.branche, 120)
  if (branche) aus.branche = branche
  const dl = typeof o.dienstleistungen === 'string' ? o.dienstleistungen.split(/[,;\n]/) : o.dienstleistungen
  const dienstleistungen = textListe(dl, 150)
  if (dienstleistungen.length) aus.dienstleistungen = dienstleistungen
  return aus
}

// ---------- Fragebogen-Vorlagen ----------

function feinNorm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Fragen aus einer Fragebogen-Vorlage (Tabelle vorlagen, Auszeichnung wie src/lib/vorlagenFuellen.ts): jedes Feld
 * {{Name}} (ohne Felder mit Vorgabe {{Name=…}} und ohne Datum, Bearbeiter, Aktenzeichen, Unterschrift; „Quelle: X“,
 * „Bemerkung: X“, „Antwort: X“ zählen als X) und jede Ankreuz-Zeile „☐ …“
 * (in Tabellen die Spalte mit dem Text). Jede Frage einmal, in der Reihenfolge der Vorlage, höchstens FRAGEBOGEN_GRENZE.
 */
export function fragenAusVorlage(vorlage: string): string[] {
  const aus: string[] = []
  const gesehen = new Set<string>()
  const dazu = (roh: string) => {
    const t = text(roh.replace(/\*\*/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/[:：]\s*$/, ''), 200).replace(/[:\s]+$/, '')
    const s = feinNorm(t)
    if (!t || s.length < 3 || gesehen.has(s) || aus.length >= FRAGEBOGEN_GRENZE) return
    gesehen.add(s)
    aus.push(t)
  }
  for (const roh of String(vorlage ?? '').split('\n')) {
    const z = roh.trim()
    if (!z || z.startsWith('#')) continue
    const zellen = z.includes('|') ? z.split('|').map((c) => c.trim()) : null
    if (z.includes('☐') || z.includes('☒')) {
      if (zellen) {
        // Tabellenzeile „☐ | Unterlage / Angabe | Erforderlich | {{Quelle: …}} | {{Bemerkung: …}}“: die Textspalte.
        const textzelle = zellen.find((c) => c && !/^[☐☒]$/.test(c) && !c.includes('{{'))
        if (textzelle) dazu(textzelle)
      } else {
        for (const teil of z.split(/[☐☒]/).slice(1)) dazu(teil.split('{{')[0])
      }
      if (zellen) continue
    }
    for (const m of z.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (m[1].includes('=')) continue
      const name = m[1].replace(/^(quelle|bemerkung|antwort)\s*:\s*/i, '')
      // Verwaltungsfelder füllt kein Gespräch.
      if (/^(datum|ort,? datum|stand \/ datum|bearbeiter|aktenzeichen|unterschrift.*)$/i.test(name.trim())) continue
      dazu(name)
    }
  }
  return aus
}

/**
 * Antworten des Modells auf die Fragenliste abbilden: über `nr` (1-basiert) oder den Fragetext (ohne Groß-/Kleinschreibung
 * und Satzzeichen). Antworten auf Fragen, die nicht in der Liste stehen, entfallen; die Frage steht danach genau wie in
 * der Vorlage.
 */
export function ordneFragebogenZu(roh: unknown, fragen: string[]): FragebogenAntwort[] {
  const index = new Map(fragen.map((f, i) => [feinNorm(f), i]))
  const zugeordnet: { i: number; antwort: unknown; sicher: unknown }[] = []
  for (const e of liste(roh)) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue
    const o = e as Record<string, unknown>
    const nr = typeof o.nr === 'number' ? o.nr : typeof o.nr === 'string' && /^\d+$/.test(o.nr.trim()) ? Number(o.nr) : NaN
    let i = Number.isInteger(nr) && nr >= 1 && nr <= fragen.length ? nr - 1 : -1
    const ausText = typeof o.frage === 'string' ? index.get(feinNorm(o.frage)) : undefined
    // Passt der Text zu einer anderen Frage als die Nummer, gilt der Text.
    if (ausText !== undefined) i = ausText
    if (i < 0) continue
    zugeordnet.push({ i, antwort: o.antwort, sicher: o.sicher })
  }
  zugeordnet.sort((a, b) => a.i - b.i)
  return normalisiereFragebogen(zugeordnet.map((z) => ({ frage: fragen[z.i], antwort: z.antwort, sicher: z.sicher })))
}

// ---------- Gesprächsnotiz an den Kunden ----------

/**
 * Vorschlag für die Gesprächsnotiz an den Kunden (Deutsch, Sie-Form): Zusammenfassung, Vereinbarungen und nächste
 * Schritte — nur aus der Auswertung. Ohne Gruß-Namen, wenn eine Signatur angehängt wird.
 */
export function gespraechsnotizText(a: Pick<GespraechAnalyse, 'zusammenfassung' | 'vereinbarungen' | 'naechste_schritte' | 'unterlagen_fehlen'>, o: { anrede?: string; datum?: string; absender?: string; mitSignatur?: boolean }): { betreff: string; text: string } {
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(o.datum ?? '') ? o.datum!.split('-').reverse().join('.') : ''
  const punkte = (titel: string, l: string[]) => (l.length ? `${titel}\n${l.map((x) => `- ${x}`).join('\n')}` : '')
  const schritte = (a.naechste_schritte ?? []).map((s) => {
    const zusatz = [s.wer ? text(s.wer, 80) : '', s.faellig && isoDatum(s.faellig) ? `bis ${isoDatum(s.faellig)!.split('-').reverse().join('.')}` : ''].filter(Boolean).join(', ')
    return zusatz ? `${text(s.text)} (${zusatz})` : text(s.text)
  }).filter(Boolean)
  const teile = [
    o.anrede?.trim() || 'Guten Tag,',
    `vielen Dank für das Gespräch${datum ? ` am ${datum}` : ''}. Hier fassen wir die wichtigsten Punkte zusammen:`,
    langtext(a.zusammenfassung, 3000),
    punkte('Vereinbart:', textListe(a.vereinbarungen)),
    punkte('Nächste Schritte:', schritte),
    punkte('Bitte senden Sie uns noch:', textListe(a.unterlagen_fehlen)),
    'Wenn etwas nicht stimmt oder fehlt, geben Sie uns bitte kurz Bescheid.',
    o.mitSignatur || !o.absender?.trim() ? 'Mit freundlichen Grüßen' : `Mit freundlichen Grüßen\n${o.absender.trim()}`,
  ]
  return { betreff: `Gesprächsnotiz${datum ? ` vom ${datum}` : ''}`, text: teile.filter(Boolean).join('\n\n') }
}

/** Ist die Auswertung inhaltlich leer (z. B. nur Stille aufgenommen)? */
export function istLeereAnalyse(a: GespraechAnalyse): boolean {
  return !a.zusammenfassung && a.kernthemen.length === 0 && a.vereinbarungen.length === 0 && a.todos.length === 0 && a.termine.length === 0
}
