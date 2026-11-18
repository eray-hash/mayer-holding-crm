// Pivot-Auswertung (Kreuztabelle) ohne Bildschirm und ohne Datenbank: Datensätze nach einem oder zwei
// Feldern in Zeilen und höchstens einem Feld in Spalten zusammenfassen (Anzahl, Summe, Durchschnitt,
// Minimum, Maximum), mit Zeilen-, Spalten- und Gesamtsummen. Datumsfelder lassen sich nach Tag, Woche
// (Kalenderwoche nach ISO, wie in Deutschland üblich), Monat, Quartal oder Jahr zusammenfassen.
// Bewusst ohne Abhängigkeiten, damit es sich ohne Browser prüfen lässt. Angezeigt in
// pages/auswertungen/Auswertungen.tsx, Excel-Datei in lib/pivotExport.ts.

export type FeldTyp = 'text' | 'zahl' | 'datum' | 'jaNein'

export type Feld = {
  id: string
  label: string
  typ: FeldTyp
  /** Betrag in Euro: Summe, Durchschnitt, Minimum und Maximum werden mit € angezeigt. */
  euro?: boolean
  /** Feste Reihenfolge der Werte (z. B. Hoch, Mittel, Niedrig); nicht genannte folgen alphabetisch. */
  reihenfolge?: string[]
}

export type Wert = string | number | boolean | null | undefined
export type Datensatz = Record<string, Wert>

export type Gruppierung = 'tag' | 'woche' | 'monat' | 'quartal' | 'jahr'
export type Berechnung = 'anzahl' | 'summe' | 'durchschnitt' | 'minimum' | 'maximum'

export type FeldWahl = { feld: string; gruppierung?: Gruppierung }

/** Filter auf ein Feld: Datensätze mit einem dieser Werte (Schlüssel wie in werteListe) fallen heraus.
 *  Ausschließen statt Einschließen, damit neu hinzukommende Werte nicht unbemerkt fehlen. */
export type Filter = { feld: string; ohne: string[]; gruppierung?: Gruppierung }

export type Einstellung = {
  /** Ein oder zwei Felder für die Zeilen. */
  zeilen: FeldWahl[]
  /** Kein oder ein Feld für die Spalten. */
  spalten: FeldWahl[]
  berechnung: Berechnung
  /** Zahlenfeld für Summe, Durchschnitt, Minimum und Maximum; bei Anzahl ohne Bedeutung. */
  wert?: string
  filter: Filter[]
  /** Zeitraum über das Hauptdatum der Quelle (JJJJ-MM-TT, beide Grenzen eingeschlossen). */
  von?: string
  bis?: string
}

export const GRUPPIERUNGEN: { id: Gruppierung; label: string }[] = [
  { id: 'tag', label: 'Tag' },
  { id: 'woche', label: 'Woche' },
  { id: 'monat', label: 'Monat' },
  { id: 'quartal', label: 'Quartal' },
  { id: 'jahr', label: 'Jahr' },
]

export const BERECHNUNGEN: { id: Berechnung; label: string }[] = [
  { id: 'anzahl', label: 'Anzahl' },
  { id: 'summe', label: 'Summe' },
  { id: 'durchschnitt', label: 'Durchschnitt' },
  { id: 'minimum', label: 'Minimum' },
  { id: 'maximum', label: 'Maximum' },
]

/** Schlüssel für „kein Wert". */
export const LEER = ''
export const LEER_TEXT = '(leer)'

// ── Datum ────────────────────────────────────────────────────────────────────────────────────────

const zwei = (n: number) => String(n).padStart(2, '0')

function gueltigesDatum(y: number, m: number, d: number): string | undefined {
  if (!Number.isInteger(y) || y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return undefined
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1) return undefined
  return `${y}-${zwei(m)}-${zwei(d)}`
}

/** Wert → Kalenderdatum JJJJ-MM-TT. Zeitstempel mit Uhrzeit (z. B. „2026-11-17T23:30:00Z") zählen
 *  zum Tag in der Ortszeit des Browsers, reine Daten bleiben, wie sie sind. Sonst undefined. */
export function alsIsoDatum(v: Wert | Date): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : `${v.getFullYear()}-${zwei(v.getMonth() + 1)}-${zwei(v.getDate())}`
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(t)
  if (!m) return undefined
  const rest = m[4]
  if (rest && /^T\d/.test(rest) && /(Z|[+-]\d{2}:?\d{2})$/.test(rest)) {
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? undefined : alsIsoDatum(d)
  }
  return gueltigesDatum(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** Kalenderwoche nach ISO 8601: Woche 1 enthält den ersten Donnerstag des Jahres; das Wochenjahr kann
 *  vom Kalenderjahr abweichen (31.12.2024 liegt in KW 1/2025, 1.1.2027 in KW 53/2026). */
export function isoWoche(iso: string): { jahr: number; woche: number } {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const wochentag = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - wochentag) // Donnerstag derselben Woche
  const jahr = t.getUTCFullYear()
  const tagImJahr = Math.round((t.getTime() - Date.UTC(jahr, 0, 1)) / 86400000)
  return { jahr, woche: Math.floor(tagImJahr / 7) + 1 }
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function datumsSchluessel(iso: string, g: Gruppierung): string {
  const y = iso.slice(0, 4)
  const m = Number(iso.slice(5, 7))
  switch (g) {
    case 'tag':
      return iso
    case 'woche': {
      const w = isoWoche(iso)
      return `${w.jahr}-W${zwei(w.woche)}`
    }
    case 'monat':
      return iso.slice(0, 7)
    case 'quartal':
      return `${y}-Q${Math.ceil(m / 3)}`
    case 'jahr':
      return y
  }
}

function datumsBeschriftung(schluessel: string, g: Gruppierung): string {
  switch (g) {
    case 'tag':
      return `${schluessel.slice(8, 10)}.${schluessel.slice(5, 7)}.${schluessel.slice(0, 4)}`
    case 'woche':
      return `KW ${Number(schluessel.slice(6))}/${schluessel.slice(0, 4)}`
    case 'monat':
      return `${MONATE[Number(schluessel.slice(5, 7)) - 1]} ${schluessel.slice(0, 4)}`
    case 'quartal':
      return `${schluessel.slice(6)}. Quartal ${schluessel.slice(0, 4)}`
    case 'jahr':
      return schluessel
  }
}

/** TT.MM.JJJJ für die Anzeige eines einzelnen Datums. */
export function datumDeutsch(iso: string | undefined): string {
  return iso ? datumsBeschriftung(iso, 'tag') : ''
}

// ── Zahlen ───────────────────────────────────────────────────────────────────────────────────────

export function alsZahl(v: Wert): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  return undefined
}

/** Deutsche Schreibweise: 1.234,56 € bzw. 1.234,5. null → „–". */
export function formatiereZahl(n: number | null | undefined, euro = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  const glatt = Math.abs(n) < 0.005 ? 0 : n
  if (euro) return glatt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return glatt.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

// ── Schlüssel und Beschriftungen ─────────────────────────────────────────────────────────────────

/** Gruppierung, die für ein Feld tatsächlich gilt (Datumsfelder ohne Angabe: Tag). */
export function wirksameGruppierung(feld: Feld | undefined, g: Gruppierung | undefined): Gruppierung | undefined {
  if (!feld || feld.typ !== 'datum') return undefined
  return g ?? 'tag'
}

/** Schlüssel eines Werts zum Zusammenfassen. Leere Werte → LEER. */
export function schluessel(v: Wert, feld: Feld, g?: Gruppierung): string {
  if (v === null || v === undefined) return LEER
  switch (feld.typ) {
    case 'datum': {
      const iso = alsIsoDatum(v)
      return iso ? datumsSchluessel(iso, g ?? 'tag') : LEER
    }
    case 'jaNein':
      if (typeof v === 'boolean') return v ? 'ja' : 'nein'
      return String(v).trim().toLowerCase() === 'ja' ? 'ja' : String(v).trim() === '' ? LEER : 'nein'
    case 'zahl': {
      const n = typeof v === 'number' ? v : Number.NaN
      return Number.isFinite(n) ? String(n) : LEER
    }
    case 'text':
      return String(v).replace(/\s+/g, ' ').trim()
  }
}

export function beschriftung(s: string, feld: Feld, g?: Gruppierung): string {
  if (s === LEER) return LEER_TEXT
  switch (feld.typ) {
    case 'datum':
      return datumsBeschriftung(s, g ?? 'tag')
    case 'jaNein':
      return s === 'ja' ? 'Ja' : 'Nein'
    case 'zahl':
      return formatiereZahl(Number(s), feld.euro)
    case 'text':
      return s
  }
}

const textVergleich = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

/** Sortierung der Schlüssel: leere Werte zuletzt, dann feste Reihenfolge, Zahlen nach Größe, Daten
 *  zeitlich, Text alphabetisch. */
export function vergleicheSchluessel(a: string, b: string, feld: Feld): number {
  if (a === b) return 0
  if (a === LEER) return 1
  if (b === LEER) return -1
  if (feld.typ === 'zahl') return Number(a) - Number(b)
  if (feld.typ === 'datum') return a < b ? -1 : 1
  if (feld.typ === 'jaNein') return a === 'ja' ? -1 : 1
  if (feld.reihenfolge) {
    const ia = feld.reihenfolge.indexOf(a)
    const ib = feld.reihenfolge.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
  }
  return textVergleich.compare(a, b)
}

/** Alle vorkommenden Werte eines Felds mit Anzahl, sortiert — für die Filterauswahl. */
export function werteListe(daten: Datensatz[], feld: Feld, g?: Gruppierung): { schluessel: string; label: string; anzahl: number }[] {
  const zaehler = new Map<string, number>()
  for (const d of daten) {
    const s = schluessel(d[feld.id], feld, g)
    zaehler.set(s, (zaehler.get(s) ?? 0) + 1)
  }
  return [...zaehler.entries()]
    .sort(([a], [b]) => vergleicheSchluessel(a, b, feld))
    .map(([s, anzahl]) => ({ schluessel: s, label: beschriftung(s, feld, g), anzahl }))
}

// ── Filtern ──────────────────────────────────────────────────────────────────────────────────────

/** Wendet die Filter und den Zeitraum an. Ist ein Zeitraum gesetzt, fallen Datensätze ohne Datum heraus. */
export function filtere(daten: Datensatz[], felder: Feld[], e: Pick<Einstellung, 'filter' | 'von' | 'bis'>, hauptdatum?: string): Datensatz[] {
  const nachId = new Map(felder.map((f) => [f.id, f]))
  const aktiv = e.filter
    .map((f) => ({ feld: nachId.get(f.feld), ohne: new Set(f.ohne), g: f.gruppierung }))
    .filter((f): f is { feld: Feld; ohne: Set<string>; g: Gruppierung | undefined } => !!f.feld && f.ohne.size > 0)
  const von = e.von || undefined
  const bis = e.bis || undefined
  const mitZeitraum = !!hauptdatum && nachId.has(hauptdatum) && (!!von || !!bis)
  if (!aktiv.length && !mitZeitraum) return daten
  return daten.filter((d) => {
    if (mitZeitraum) {
      const iso = alsIsoDatum(d[hauptdatum!])
      if (!iso) return false
      if (von && iso < von) return false
      if (bis && iso > bis) return false
    }
    for (const f of aktiv) if (f.ohne.has(schluessel(d[f.feld.id], f.feld, wirksameGruppierung(f.feld, f.g)))) return false
    return true
  })
}

// ── Zusammenfassen ───────────────────────────────────────────────────────────────────────────────

export type Aggregat = {
  /** Zahl der Datensätze. */
  anzahl: number
  /** Zahl der Datensätze mit einem Zahlenwert im Wertfeld. */
  nWerte: number
  summe: number
  min: number
  max: number
}

function neuesAggregat(): Aggregat {
  return { anzahl: 0, nWerte: 0, summe: 0, min: Infinity, max: -Infinity }
}

function hinzu(a: Aggregat, wert: number | undefined) {
  a.anzahl++
  if (wert === undefined) return
  a.nWerte++
  a.summe += wert
  if (wert < a.min) a.min = wert
  if (wert > a.max) a.max = wert
}

/** Ergebnis einer Zelle; null, wenn es nichts zu rechnen gibt (keine Zahlen im Wertfeld). */
export function aggregatWert(a: Aggregat | undefined, berechnung: Berechnung): number | null {
  if (!a) return null
  switch (berechnung) {
    case 'anzahl':
      return a.anzahl
    case 'summe':
      return a.nWerte ? Math.round(a.summe * 1e6) / 1e6 : null
    case 'durchschnitt':
      return a.nWerte ? a.summe / a.nWerte : null
    case 'minimum':
      return a.nWerte ? a.min : null
    case 'maximum':
      return a.nWerte ? a.max : null
  }
}

export type Kopf = {
  schluessel: string
  /** Beschriftung je Ebene (bei zwei Zeilenfeldern zwei Einträge). */
  teile: string[]
}

export type PivotErgebnis = {
  zeilen: Kopf[]
  /** Leer, wenn kein Spaltenfeld gewählt ist — dann gibt es nur die Gesamtspalte. */
  spalten: Kopf[]
  zellen: Map<string, Aggregat>
  zeilenSumme: Map<string, Aggregat>
  spaltenSumme: Map<string, Aggregat>
  gesamt: Aggregat
  /** Die gefilterten Datensätze und je Datensatz sein Zeilen- und Spaltenschlüssel. */
  datensaetze: Datensatz[]
  zeilenSchluessel: string[]
  spaltenSchluessel: string[]
}

const TRENNER = '\u0001'

export function zellenSchluessel(zeile: string, spalte: string): string {
  return zeile + TRENNER + spalte
}

/** Die wirksame Einstellung: unbekannte Felder entfernt, höchstens zwei Zeilen- und ein Spaltenfeld,
 *  Wertfeld nur, wenn es ein Zahlenfeld ist (sonst wird gezählt). */
export function bereinige(e: Einstellung, felder: Feld[]): Einstellung {
  const nachId = new Map(felder.map((f) => [f.id, f]))
  const liste = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
  const wahl = (w: FeldWahl): FeldWahl | null => {
    const f = w && typeof w === 'object' ? nachId.get(w.feld) : undefined
    if (!f) return null
    const g = GRUPPIERUNGEN.some((x) => x.id === w.gruppierung) ? w.gruppierung : 'monat'
    return f.typ === 'datum' ? { feld: f.id, gruppierung: g } : { feld: f.id }
  }
  const zeilen = liste<FeldWahl>(e?.zeilen).map(wahl).filter((w): w is FeldWahl => !!w).slice(0, 2)
  const spalten = liste<FeldWahl>(e?.spalten).map(wahl).filter((w): w is FeldWahl => !!w).slice(0, 1)
  const wertFeld = typeof e?.wert === 'string' ? nachId.get(e.wert) : undefined
  const wert = wertFeld?.typ === 'zahl' ? wertFeld.id : undefined
  const berechnung: Berechnung = BERECHNUNGEN.some((b) => b.id === e?.berechnung) && (e.berechnung === 'anzahl' || wert) ? e.berechnung : 'anzahl'
  const filter = liste<Filter>(e?.filter)
    .filter((f) => f && nachId.has(f.feld) && Array.isArray(f.ohne))
    .map((f) => ({ feld: f.feld, ohne: f.ohne.map(String), ...(f.gruppierung ? { gruppierung: f.gruppierung } : {}) }))
  const datumOk = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined)
  return { zeilen, spalten, berechnung, wert, filter, von: datumOk(e?.von), bis: datumOk(e?.bis) }
}

/** Rechnet die Kreuztabelle. Ohne Zeilenfeld fällt alles in eine Zeile „Gesamt". */
export function berechnePivot(daten: Datensatz[], felder: Feld[], einstellung: Einstellung, hauptdatum?: string): PivotErgebnis {
  const e = bereinige(einstellung, felder)
  const nachId = new Map(felder.map((f) => [f.id, f]))
  const gefiltert = filtere(daten, felder, e, hauptdatum)

  const zeilenWahl = e.zeilen.map((w) => ({ feld: nachId.get(w.feld)!, g: wirksameGruppierung(nachId.get(w.feld), w.gruppierung) }))
  const spaltenWahl = e.spalten.map((w) => ({ feld: nachId.get(w.feld)!, g: wirksameGruppierung(nachId.get(w.feld), w.gruppierung) }))
  const wertId = e.berechnung === 'anzahl' ? undefined : e.wert

  const zellen = new Map<string, Aggregat>()
  const zeilenSumme = new Map<string, Aggregat>()
  const spaltenSumme = new Map<string, Aggregat>()
  const gesamt = neuesAggregat()
  const zeilenTeile = new Map<string, string[]>() // Schlüssel → Einzelschlüssel je Ebene
  const spaltenTeile = new Map<string, string[]>()
  const zeilenSchluessel: string[] = new Array(gefiltert.length)
  const spaltenSchluessel: string[] = new Array(gefiltert.length)

  const hole = (m: Map<string, Aggregat>, k: string) => {
    let a = m.get(k)
    if (!a) m.set(k, (a = neuesAggregat()))
    return a
  }

  for (let i = 0; i < gefiltert.length; i++) {
    const d = gefiltert[i]
    const zt = zeilenWahl.map((w) => schluessel(d[w.feld.id], w.feld, w.g))
    const st = spaltenWahl.map((w) => schluessel(d[w.feld.id], w.feld, w.g))
    const zk = zt.join(TRENNER)
    const sk = st.join(TRENNER)
    if (!zeilenTeile.has(zk)) zeilenTeile.set(zk, zt)
    if (!spaltenTeile.has(sk)) spaltenTeile.set(sk, st)
    zeilenSchluessel[i] = zk
    spaltenSchluessel[i] = sk
    const wert = wertId ? alsZahl(d[wertId]) : undefined
    hinzu(hole(zellen, zellenSchluessel(zk, sk)), wert)
    hinzu(hole(zeilenSumme, zk), wert)
    hinzu(hole(spaltenSumme, sk), wert)
    hinzu(gesamt, wert)
  }

  const sortiere = (teile: Map<string, string[]>, wahl: { feld: Feld; g?: Gruppierung }[]): Kopf[] =>
    [...teile.entries()]
      .sort(([, a], [, b]) => {
        for (let i = 0; i < wahl.length; i++) {
          const c = vergleicheSchluessel(a[i], b[i], wahl[i].feld)
          if (c !== 0) return c
        }
        return 0
      })
      .map(([k, t]) => ({ schluessel: k, teile: t.map((s, i) => beschriftung(s, wahl[i].feld, wahl[i].g)) }))

  const zeilen = zeilenWahl.length ? sortiere(zeilenTeile, zeilenWahl) : gefiltert.length ? [{ schluessel: '', teile: ['Gesamt'] }] : []
  const spalten = spaltenWahl.length ? sortiere(spaltenTeile, spaltenWahl) : []
  return { zeilen, spalten, zellen, zeilenSumme, spaltenSumme, gesamt, datensaetze: gefiltert, zeilenSchluessel, spaltenSchluessel }
}

/** Die Datensätze hinter einer Zelle, Zeilen- oder Spaltensumme (undefined = alle). */
export function datensaetzeFuer(erg: PivotErgebnis, zeile?: string, spalte?: string): Datensatz[] {
  const aus: Datensatz[] = []
  for (let i = 0; i < erg.datensaetze.length; i++) {
    if (zeile !== undefined && erg.zeilenSchluessel[i] !== zeile) continue
    if (spalte !== undefined && erg.spaltenSchluessel[i] !== spalte) continue
    aus.push(erg.datensaetze[i])
  }
  return aus
}

/** Wert eines Datensatzes für die Anzeige in einer Liste (Datum als TT.MM.JJJJ, Zahl deutsch). */
export function zeigeWert(v: Wert, feld: Feld): string {
  if (v === null || v === undefined || v === '') return ''
  if (feld.typ === 'datum') return datumDeutsch(alsIsoDatum(v)) || String(v)
  if (feld.typ === 'jaNein') return schluessel(v, feld) === 'ja' ? 'Ja' : 'Nein'
  if (feld.typ === 'zahl') return typeof v === 'number' ? formatiereZahl(v, feld.euro) : String(v)
  return String(v)
}

/** Ist das Ergebnis ein Euro-Betrag? (Anzahl nie.) */
export function ergebnisInEuro(e: Pick<Einstellung, 'berechnung' | 'wert'>, felder: Feld[]): boolean {
  if (e.berechnung === 'anzahl' || !e.wert) return false
  return !!felder.find((f) => f.id === e.wert)?.euro
}

/** „Summe von Brutto" / „Anzahl" — Überschrift für die Werte. */
export function wertBeschriftung(e: Pick<Einstellung, 'berechnung' | 'wert'>, felder: Feld[]): string {
  if (e.berechnung === 'anzahl') return 'Anzahl'
  const f = felder.find((x) => x.id === e.wert)
  const b = BERECHNUNGEN.find((x) => x.id === e.berechnung)?.label ?? ''
  return f ? `${b} von ${f.label}` : b
}

/** Feldname mit Gruppierung: „Rechnungsdatum (Monat)". */
export function wahlBeschriftung(w: FeldWahl, felder: Feld[]): string {
  const f = felder.find((x) => x.id === w.feld)
  if (!f) return w.feld
  const g = wirksameGruppierung(f, w.gruppierung)
  return g ? `${f.label} (${GRUPPIERUNGEN.find((x) => x.id === g)!.label})` : f.label
}

/** Filter und Zeitraum in Worten, für die Excel-Datei. */
export function filterInWorten(e: Einstellung, felder: Feld[], daten: Datensatz[], hauptdatum?: string): string {
  const teile: string[] = []
  for (const f of e.filter) {
    const feld = felder.find((x) => x.id === f.feld)
    if (!feld || f.ohne.length === 0) continue
    const labels = new Map(werteListe(daten, feld, f.gruppierung).map((w) => [w.schluessel, w.label]))
    teile.push(`${feld.label} ohne ${f.ohne.map((k) => labels.get(k) ?? (k || '(leer)')).join(', ')}`)
  }
  const datum = felder.find((x) => x.id === hauptdatum)
  if (datum && (e.von || e.bis)) {
    teile.push(`${datum.label} ${e.von ? `ab ${datumDeutsch(e.von)}` : ''}${e.von && e.bis ? ' ' : ''}${e.bis ? `bis ${datumDeutsch(e.bis)}` : ''}`)
  }
  return teile.join('; ')
}
