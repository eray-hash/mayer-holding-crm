// Abgleich zwischen Gesuchen (wer sucht was) und Objekten auf dem Server — reine Rechnung ohne Datenbank.
// Genutzt von der Treffer-Meldung (email-gateway/gesuchTreffer.ts) und vom Assistenten
// (telegram-gateway/gesucheWerkzeuge.ts: „Welche Käufer passen zu diesem Objekt?“).
//
// WICHTIG: Die Regeln hier (pruefe, gesucheDesKontakts) müssen genau gleich bleiben wie in
// src/lib/gesuche.ts. Dort rechnet der Browser auf den Programm-Daten, hier der Server auf den Zeilen der
// Datenbank. Wer die Regeln an einer Stelle ändert, ändert sie an beiden — sonst meldet der Server Treffer,
// die die Seite „Gesuche“ nicht zeigt (oder umgekehrt).
//
// Mayer und Privat streng getrennt (seit 20.11.2026): Gesuche von Mayer-Kontakten nur gegen Mayer-Objekte
// (`privat_besitzer` leer), Gesuche privater Kontakte (Bereich „privat“, `privat_art` „immobilienkunden“) nur
// gegen private Objekte DESSELBEN Besitzers (bestandVon).

import { istPrivatesObjekt, normalisiereAdresse } from './privatZugriff.ts'

export type KundenZeile = {
  id: string
  bereich?: string | null
  firma?: string | null
  ansprechpartner?: string | null
  verantwortlich?: string | null
  /** Besitzer eines privaten Kontakts (Bereich „privat“). */
  verantwortlich_email?: string | null
  /** Welchem Mayer-Ablauf ein privater Kontakt folgt; nur „immobilienkunden“ hat Gesuche. */
  privat_art?: string | null
  /** jsonb: Liste der Gesuche, Feldnamen wie im Browser (objekttypen, lage, budgetMin, budgetMax, faktorMax,
   *  einheitenMin, einheitenMax, baujahrMin, baujahrMax, erledigt). */
  gesuche?: unknown
  /** jsonb: älteres Käuferprofil (objekttypen, bevorzugteLage, budgetMin, budgetMax). */
  kaeuferprofil?: unknown
}

export type ObjektZeile = {
  id: string
  bezeichnung?: string | null
  adresse?: string | null
  typ?: string | null
  kaufpreis?: number | string | null
  status?: string | null
  verantwortlich?: string | null
  zugewiesener_kunde?: unknown
  verkaufsdaten?: unknown
  activities?: unknown
  /** Besitzer eines privaten Objekts; leer = Mayer-Objekt. */
  privat_besitzer?: string | null
}

export type Gesuch = {
  id: string
  titel: string
  objekttypen: string[]
  lage: string
  budgetMin?: number | null
  budgetMax?: number | null
  faktorMax?: number | null
  einheitenMin?: number | null
  einheitenMax?: number | null
  baujahrMin?: number | null
  baujahrMax?: number | null
  erledigt?: boolean
  /** Nur zum Anzeigen und Suchen, nicht für den Abgleich. */
  nutzung?: string
  notizen?: string
}

export type AbgleichObjekt = {
  id: string
  bezeichnung: string
  adresse: string
  typ: string
  kaufpreis: number
  status: string
  zugewiesen: boolean
  verantwortlich: string
  artUngeprueft: boolean
  /** verkaufsdaten.kennzahlen (Baujahr, Einheiten, Jahresnettokaltmiete, Kaufpreisvorstellung). */
  kennzahlen: Record<string, unknown> | undefined
  /** Besitzer eines privaten Objekts (klein geschrieben), leer = Mayer-Objekt. */
  besitzer: string
}

/** Ergebnis eines passenden Paares: was passt (wortgleich zu src/lib/gesuche.ts), dasselbe in Kurzform, was offen ist. */
export type Pruefung = { passt: string[]; passtKurz: string[]; offen: string[] }

// Verkaufte, abgebrochene und archivierte Objekte stehen nicht mehr zur Vermittlung.
const NICHT_VERFUEGBAR = new Set(['verkauft', 'archiv', 'abgebrochen'])

/** Orte eines Gesuchs als einzelne Suchwörter ("Ulm, Neu-Ulm und Umgebung" → ["ulm", "neu-ulm"]). */
function orte(lage: string): string[] {
  return lage
    .toLowerCase()
    .split(/[,;/]|\bund\b|\boder\b/)
    .map((t) => t.replace(/\b(umgebung|raum|region|kreis|landkreis|großraum|nähe|bis)\b/g, '').trim())
    .filter((t) => t.length >= 3)
}

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : wert == null ? '' : String(wert)
}

function alsObjekt(wert: unknown): Record<string, unknown> | null {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null
}

/** Bei übernommenen Objekten steht im ersten Verlaufseintrag, wenn die Objektart nur ein Platzhalter ist. */
function artUngeprueft(zeile: ObjektZeile): boolean {
  // Sobald im Verkaufsdatenblatt eine Objektart gewählt ist, gilt sie als geprüft.
  if (alsObjekt(alsObjekt(zeile.verkaufsdaten)?.uebersicht)?.objektart) return false
  const verlauf = Array.isArray(zeile.activities) ? zeile.activities : []
  return verlauf.some((a) => {
    const eintrag = alsObjekt(a)
    return !!eintrag && text(eintrag.id).startsWith('a_ql_') && /Noch nicht geprüft:[^.]*Objektart/.test(text(eintrag.text))
  })
}

/** Eine Zeile der Tabelle `objekte` so lesen, wie der Browser sie liest (rowToObjekt in src/lib/crmSync.ts). */
export function objektAusZeile(zeile: ObjektZeile): AbgleichObjekt {
  return {
    id: text(zeile.id),
    bezeichnung: text(zeile.bezeichnung),
    adresse: text(zeile.adresse),
    typ: text(zeile.typ),
    kaufpreis: Number(zeile.kaufpreis),
    status: text(zeile.status),
    zugewiesen: !!zeile.zugewiesener_kunde,
    verantwortlich: text(zeile.verantwortlich),
    artUngeprueft: artUngeprueft(zeile),
    kennzahlen: alsObjekt(alsObjekt(zeile.verkaufsdaten)?.kennzahlen) ?? undefined,
    besitzer: istPrivatesObjekt(zeile) ? normalisiereAdresse(zeile.privat_besitzer) : '',
  }
}

function gesuchAusJson(wert: unknown): Gesuch | null {
  const g = alsObjekt(wert)
  if (!g) return null
  return {
    id: text(g.id),
    titel: text(g.titel),
    objekttypen: Array.isArray(g.objekttypen) ? g.objekttypen.map(text) : [],
    lage: text(g.lage),
    budgetMin: g.budgetMin as number | null | undefined,
    budgetMax: g.budgetMax as number | null | undefined,
    faktorMax: g.faktorMax as number | null | undefined,
    einheitenMin: g.einheitenMin as number | null | undefined,
    einheitenMax: g.einheitenMax as number | null | undefined,
    baujahrMin: g.baujahrMin as number | null | undefined,
    baujahrMax: g.baujahrMax as number | null | undefined,
    erledigt: !!g.erledigt,
    nutzung: text(g.nutzung),
    notizen: text(g.notizen),
  }
}

/** Alle Gesuche eines Kontakts. Ein älteres „Käuferprofil“ zählt als ein Gesuch mit. */
export function gesucheDesKontakts(kunde: KundenZeile): Gesuch[] {
  const liste: Gesuch[] = []
  for (const roh of Array.isArray(kunde.gesuche) ? kunde.gesuche : []) {
    const g = gesuchAusJson(roh)
    if (g) liste.push(g)
  }
  const p = alsObjekt(kunde.kaeuferprofil)
  if (p) {
    const objekttypen = Array.isArray(p.objekttypen) ? p.objekttypen.map(text) : []
    const lage = text(p.bevorzugteLage)
    if (lage.trim() || objekttypen.length > 0 || p.budgetMin != null || p.budgetMax != null) {
      liste.push({
        id: `kaeuferprofil:${kunde.id}`,
        titel: 'Käuferprofil',
        objekttypen,
        lage,
        budgetMin: p.budgetMin as number | null | undefined,
        budgetMax: p.budgetMax as number | null | undefined,
        nutzung: text(p.nutzung),
        notizen: text(p.notizen),
      })
    }
  }
  return liste
}

// ---- Eckdaten aus dem Verkaufsdatenblatt (Kaufpreisfaktor, Einheiten, Baujahr) ----
// Die Werte stehen dort teils als Freitext („ca. 1965“, „6 WE + 1 Gewerbe“). Gelesen wird nur, was
// eindeutig ist; alles andere gilt als unbekannt und macht das Paar „zu prüfen“ — nie zum Ausschluss.

/** Positive Zahl aus einem gespeicherten Wert, sonst 0. */
function positiv(wert: unknown): number {
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' && wert.trim() !== '' ? Number(wert) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}

function freitext(wert: unknown): string {
  return typeof wert === 'string' ? wert.trim() : typeof wert === 'number' && Number.isFinite(wert) ? String(wert) : ''
}

/** Genau eine Jahreszahl im Text („ca. 1965“ → 1965). undefined = leer, null = keine oder mehrere Jahreszahlen. */
function jahrAusText(wert: unknown): number | null | undefined {
  const t = freitext(wert)
  if (!t) return undefined
  const jahre = new Set(t.match(/\b(1[6-9]\d\d|20\d\d)\b/g) ?? [])
  return jahre.size === 1 ? Number([...jahre][0]) : null
}

/** Genau eine ganze Zahl im Text („8 WE“ → 8). undefined = leer, null = keine, mehrere („6 WE + 1 Gewerbe“) oder keine ganze Zahl. */
function anzahlAusText(wert: unknown): number | null | undefined {
  const t = freitext(wert)
  if (!t) return undefined
  const zahlen = t.match(/\d+(?:[.,]\d+)?/g) ?? []
  if (zahlen.length !== 1 || !/^\d+$/.test(zahlen[0])) return null
  const n = Number(zahlen[0])
  return n > 0 ? n : null
}

/** 18.5 → „18,5“, 20 → „20“. */
function kommazahl(n: number): string {
  return n.toFixed(1).replace('.', ',').replace(/,0$/, '')
}

/** Prüft ein Objekt gegen ein Gesuch. null = passt nicht. */
export function pruefe(gesuch: Gesuch, o: AbgleichObjekt): Pruefung | null {
  if (NICHT_VERFUEGBAR.has(o.status) || o.zugewiesen) return null
  const passt: string[] = []
  const passtKurz: string[] = []
  const offen: string[] = []

  if (gesuch.objekttypen.length > 0) {
    if (o.artUngeprueft) {
      // Aus einem Ordner übernommen, die Objektart ist nur ein Platzhalter: weder Treffer noch Ausschluss.
      offen.push('Objektart beim Objekt noch nicht geprüft')
    } else {
      if (!gesuch.objekttypen.includes(o.typ)) return null
      passt.push(`Objektart ${o.typ}`)
      passtKurz.push('Objektart')
    }
  }

  const suchorte = orte(gesuch.lage)
  if (suchorte.length > 0) {
    const wo = `${o.adresse} ${o.bezeichnung}`.toLowerCase()
    const ort = suchorte.find((t) => wo.includes(t))
    if (!ort) return null
    passt.push(`Lage ${o.adresse || o.bezeichnung}`)
    passtKurz.push('Lage')
  }

  const kennzahlen = o.kennzahlen

  // Budget: verglichen wird der Kaufpreis des Objekts, fehlt er, die Kaufpreisvorstellung aus dem
  // Verkaufsdatenblatt (wie beim Faktor; Quirins Wunsch vom 18.11.2026).
  if (gesuch.budgetMin != null || gesuch.budgetMax != null) {
    const ausVorstellung = !(o.kaufpreis > 0)
    const preis = o.kaufpreis > 0 ? o.kaufpreis : positiv(kennzahlen?.kaufpreisvorstellung)
    if (preis > 0) {
      if (gesuch.budgetMin != null && preis < gesuch.budgetMin) return null
      if (gesuch.budgetMax != null && preis > gesuch.budgetMax) return null
      passt.push(`Preis im Budget${ausVorstellung ? ' (aus Kaufpreisvorstellung)' : ''}`)
      passtKurz.push('Preis im Budget')
    } else {
      offen.push('Kaufpreis und Kaufpreisvorstellung nicht hinterlegt')
    }
  }

  // Kaufpreisfaktor = Preis ÷ Jahresnettokaltmiete. Preis: der Kaufpreis des Objekts, fehlt er, die
  // Kaufpreisvorstellung aus dem Verkaufsdatenblatt. Verglichen wird der auf eine Stelle gerundete Wert.
  if (gesuch.faktorMax != null) {
    const ausVorstellung = !(o.kaufpreis > 0)
    const preis = o.kaufpreis > 0 ? o.kaufpreis : positiv(kennzahlen?.kaufpreisvorstellung)
    const miete = positiv(kennzahlen?.jahresnettokaltmiete)
    if (preis > 0 && miete > 0) {
      const faktor = Math.round((preis / miete) * 10) / 10
      if (faktor > gesuch.faktorMax) return null
      passt.push(`Faktor ${kommazahl(faktor)}${ausVorstellung ? ' (aus Kaufpreisvorstellung)' : ''}`)
      passtKurz.push('Faktor')
    } else {
      offen.push(`Faktor nicht berechenbar (${preis > 0 ? 'Jahresmiete fehlt' : miete > 0 ? 'Kaufpreis fehlt' : 'Kaufpreis und Jahresmiete fehlen'})`)
    }
  }

  if (gesuch.einheitenMin != null || gesuch.einheitenMax != null) {
    const anzahl = anzahlAusText(kennzahlen?.einheiten)
    if (anzahl == null) {
      offen.push(anzahl === undefined ? 'Einheiten beim Objekt nicht hinterlegt' : 'Einheiten beim Objekt nicht eindeutig')
    } else {
      if (gesuch.einheitenMin != null && anzahl < gesuch.einheitenMin) return null
      if (gesuch.einheitenMax != null && anzahl > gesuch.einheitenMax) return null
      passt.push(anzahl === 1 ? '1 Einheit' : `${anzahl} Einheiten`)
      passtKurz.push('Einheiten')
    }
  }

  if (gesuch.baujahrMin != null || gesuch.baujahrMax != null) {
    const jahr = jahrAusText(kennzahlen?.baujahr)
    if (jahr == null) {
      offen.push(jahr === undefined ? 'Baujahr beim Objekt nicht hinterlegt' : 'Baujahr beim Objekt nicht eindeutig')
    } else {
      if (gesuch.baujahrMin != null && jahr < gesuch.baujahrMin) return null
      if (gesuch.baujahrMax != null && jahr > gesuch.baujahrMax) return null
      passt.push(`Baujahr ${jahr}`)
      passtKurz.push('Baujahr')
    }
  }

  // Ein Gesuch ganz ohne Angaben würde auf alles passen — das hilft niemandem.
  if (passt.length === 0) return null
  return { passt, passtKurz, offen }
}

/** Wessen Bestand ein Kontakt durchsucht: '' = Mayer-Objekte, eine Adresse = die privaten Objekte dieses
 *  Besitzers, null = gar keine (privater Kontakt ohne Besitzer oder nicht im Immobilien-Ablauf). */
export function bestandVon(kunde: KundenZeile): string | null {
  if (kunde.bereich !== 'privat') return ''
  if (kunde.privat_art !== 'immobilienkunden') return null
  return normalisiereAdresse(kunde.verantwortlich_email) || null
}

/** Reihenfolge wie passendeObjekte in src/lib/gesuche.ts: erst die mit wenig Offenem, dann die mit viel Passendem. */
export function vergleichePruefungen(a: Pruefung, b: Pruefung): number {
  return a.offen.length - b.offen.length || b.passt.length - a.passt.length
}

// ---- Anzeige (gleich wie budgetText / eckdatenTexte in src/lib/gesuche.ts) ----

export function budgetText(g: Pick<Gesuch, 'budgetMin' | 'budgetMax'>): string {
  const eur = (n: number) => `${Math.round(n).toLocaleString('de-DE')} €`
  if (g.budgetMin != null && g.budgetMax != null) return `${eur(g.budgetMin)} – ${eur(g.budgetMax)}`
  if (g.budgetMax != null) return `bis ${eur(g.budgetMax)}`
  if (g.budgetMin != null) return `ab ${eur(g.budgetMin)}`
  return '–'
}

/** Die weiteren Eckdaten eines Gesuchs in Kurzform („Faktor bis 20“, „ab 6 Einheiten“, „Baujahr 1990–2010“). */
export function eckdatenTexte(g: Gesuch): string[] {
  const teile: string[] = []
  if (g.faktorMax != null) teile.push(`Faktor bis ${kommazahl(g.faktorMax)}`)
  if (g.einheitenMin != null && g.einheitenMax != null) teile.push(g.einheitenMin === g.einheitenMax ? `${g.einheitenMin} Einheiten` : `${g.einheitenMin}–${g.einheitenMax} Einheiten`)
  else if (g.einheitenMin != null) teile.push(`ab ${g.einheitenMin} Einheiten`)
  else if (g.einheitenMax != null) teile.push(`bis ${g.einheitenMax} Einheiten`)
  if (g.baujahrMin != null && g.baujahrMax != null) teile.push(g.baujahrMin === g.baujahrMax ? `Baujahr ${g.baujahrMin}` : `Baujahr ${g.baujahrMin}–${g.baujahrMax}`)
  else if (g.baujahrMin != null) teile.push(`ab Baujahr ${g.baujahrMin}`)
  else if (g.baujahrMax != null) teile.push(`bis Baujahr ${g.baujahrMax}`)
  return teile
}
