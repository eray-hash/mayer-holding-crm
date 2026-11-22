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
  /** Nur Server: Beginn der laufenden Abschrift (Sperre), Zahl der Versuche, letzter Fehler. */
  seit?: string | null
  versuche?: number
  letzter_versuch?: string | null
  fehler?: string | null
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
}

/** Höchstzahl je Liste — mehr ist bei einem Gespräch nie sinnvoll und bläht nur die Prüfansicht auf. */
export const LISTEN_GRENZE = 25

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
  return aus
}

/** Ist die Auswertung inhaltlich leer (z. B. nur Stille aufgenommen)? */
export function istLeereAnalyse(a: GespraechAnalyse): boolean {
  return !a.zusammenfassung && a.kernthemen.length === 0 && a.vereinbarungen.length === 0 && a.todos.length === 0 && a.termine.length === 0
}
