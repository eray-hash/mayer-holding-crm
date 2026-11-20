// Neue Treffer zwischen Gesuchen und Objekten von selbst bemerken und per Telegram melden — ohne
// offenes Browserfenster und ohne Klick. Der Zeitplan ruft `pruefeNeueTreffer` jede Minute; die
// eigentliche Prüfung läuft höchstens alle fünf Minuten.
//
// WICHTIG: Die Abgleich-Regeln hier (pruefe, alleGesuche, passendeObjekte) müssen genau gleich
// bleiben wie in src/lib/gesuche.ts. Dort rechnet der Browser auf den Programm-Daten, hier der
// Server auf den Zeilen der Datenbank. Wer die Regeln an einer Stelle ändert, ändert sie an beiden —
// sonst meldet der Server Treffer, die die Seite „Gesuche“ nicht zeigt (oder umgekehrt).
//
// - Jeder bekannte Treffer ist eine Zeile in `abteilung_eintraege` (art „treffer“, id
//   `treffer|<gesuchId>|<objektId>`). Der Browser liest diese Zeilen nur, er schreibt sie nie.
// - Der allererste Lauf hält alle vorhandenen Treffer still fest und meldet nichts — sonst bekäme
//   jeder auf einen Schlag Dutzende alter Treffer.
// - Gemeldet wird danach nur: ein Paar, das neu passt, und ein Paar, das von „zu prüfen“ zu einem
//   vollständigen Treffer wird. Paare, die nicht mehr passen, verschwinden still.
// - Nie doppelt melden: Die Zeile wird VOR dem Senden angelegt; gibt es sie schon, wird nicht gesendet.
// - Mayer und Privat streng getrennt (seit 20.11.2026): Gesuche von Mayer-Kontakten nur gegen Mayer-Objekte
//   (`privat_besitzer` leer). Gesuche privater Kontakte (Bereich „privat“, `privat_art` „immobilienkunden“)
//   nur gegen private Objekte DESSELBEN Besitzers. Private Treffer liegen als art „privat_treffer“ mit
//   `daten.besitzer` (nur der Besitzer kann sie lesen) und werden nur ihm gemeldet.

import { istPrivatesObjekt, normalisiereAdresse } from '../_shared/privatZugriff.ts'

// Der Dienst-Zugang zur Datenbank — wie in objektMail.ts.
// deno-lint-ignore no-explicit-any
type Db = any

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

/** So liegt ein Treffer in `abteilung_eintraege.daten` (gleich dem Typ TrefferMeldung in src/types/index.ts). */
export type TrefferMeldung = {
  id: string
  gesuchId: string
  kundeId: string
  objektId: string
  art: 'treffer' | 'pruefen'
  entdecktAm: string
  gemeldetAn: string[]
  /** Nur bei privaten Treffern (Zeilen-art „privat_treffer“): Login-Adresse des Besitzers. */
  besitzer?: string
}

/** Ein aktuell passendes Paar samt allem, was für die Nachricht gebraucht wird. */
export type BerechneterTreffer = {
  id: string
  gesuchId: string
  kundeId: string
  objektId: string
  /** „treffer“ = nichts offen, „pruefen“ = beim Objekt fehlt noch eine Angabe. */
  art: 'treffer' | 'pruefen'
  /** Wortgleich zu `passt` / `offen` in src/lib/gesuche.ts. */
  passt: string[]
  offen: string[]
  /** Dasselbe in Kurzform für die Nachricht („Objektart“, „Lage“, „Preis im Budget“, „Faktor“, „Einheiten“, „Baujahr“). */
  passtKurz: string[]
  gesuchTitel: string
  kundeName: string
  kundeVerantwortlich: string
  objektBezeichnung: string
  objektVerantwortlich: string
  /** Gesetzt = privater Treffer (Gesuch und Objekt gehören diesem Besitzer, Login-Adresse klein geschrieben). */
  besitzer?: string
}

export type TrefferErgebnis = { gelaufen: boolean; neu: number; benachrichtigt: number }
export type TrefferOptionen = { jetzt?: Date; ohneTakt?: boolean }
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

const TABELLE = 'abteilung_eintraege'
const STAND_ID = 'treffer_stand'
/** Zeilen-art der Treffer: Mayer-Treffer sehen die Mitarbeiter, private nur ihr Besitzer (Regel in der Datenbank). */
const ART_MAYER = 'treffer'
const ART_PRIVAT = 'privat_treffer'
const TAKT_MS = 5 * 60 * 1000
const HOECHSTENS_ZEILEN = 8

// ---------------------------------------------------------------------------------------------
// Abgleich — Abbild von src/lib/gesuche.ts
// ---------------------------------------------------------------------------------------------

type Gesuch = {
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
}

type Objekt = {
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
function objektAusZeile(zeile: ObjektZeile): Objekt {
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
  }
}

/** Alle Gesuche eines Kontakts. Ein älteres „Käuferprofil“ zählt als ein Gesuch mit. */
function gesucheDesKontakts(kunde: KundenZeile): Gesuch[] {
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
function pruefe(gesuch: Gesuch, o: Objekt): { passt: string[]; passtKurz: string[]; offen: string[] } | null {
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

export function trefferId(gesuchId: string, objektId: string): string {
  return `treffer|${gesuchId}|${objektId}`
}

/** Wessen Bestand ein Kontakt durchsucht: '' = Mayer-Objekte, eine Adresse = die privaten Objekte dieses
 *  Besitzers, null = gar keine (privater Kontakt ohne Besitzer oder nicht im Immobilien-Ablauf). */
function bestandVon(kunde: KundenZeile): string | null {
  if (kunde.bereich !== 'privat') return ''
  if (kunde.privat_art !== 'immobilienkunden') return null
  return normalisiereAdresse(kunde.verantwortlich_email) || null
}

/** Alle Paare aus Gesuch und Objekt, die im Augenblick zusammenpassen. Rechnet nur, liest und
 *  schreibt nichts. Erledigte Gesuche zählen nicht mit. Mayer und Privat bleiben getrennt: Gesuche von
 *  Mayer-Kontakten nur gegen Mayer-Objekte, Gesuche privater Immobilien-Kontakte nur gegen die privaten
 *  Objekte desselben Besitzers (dann ist `besitzer` gesetzt). */
export function berechneTreffer(kundenZeilen: KundenZeile[], objektZeilen: ObjektZeile[]): BerechneterTreffer[] {
  const objekte = objektZeilen.map(objektAusZeile)
  const treffer = new Map<string, BerechneterTreffer>()
  for (const kunde of kundenZeilen) {
    const bestand = bestandVon(kunde)
    if (bestand === null) continue
    for (const gesuch of gesucheDesKontakts(kunde)) {
      if (gesuch.erledigt || !gesuch.id) continue
      for (const o of objekte) {
        if (o.besitzer !== bestand) continue
        const t = pruefe(gesuch, o)
        if (!t) continue
        const id = trefferId(gesuch.id, o.id)
        // Sollten zwei Kontakte je ein Gesuch mit derselben Kennung haben, zählt das erste Paar.
        if (treffer.has(id)) continue
        treffer.set(id, {
          id,
          gesuchId: gesuch.id,
          kundeId: text(kunde.id),
          objektId: o.id,
          art: t.offen.length === 0 ? 'treffer' : 'pruefen',
          passt: t.passt,
          offen: t.offen,
          passtKurz: t.passtKurz,
          gesuchTitel: gesuch.titel,
          kundeName: text(kunde.firma).trim() || text(kunde.ansprechpartner).trim(),
          kundeVerantwortlich: text(kunde.verantwortlich),
          objektBezeichnung: o.bezeichnung,
          objektVerantwortlich: o.verantwortlich,
          ...(bestand ? { besitzer: bestand } : {}),
        })
      }
    }
  }
  return [...treffer.values()]
}

// ---------------------------------------------------------------------------------------------
// Nachricht
// ---------------------------------------------------------------------------------------------

export type MeldeEintrag = { treffer: BerechneterTreffer; anlass: 'neu' | 'vollstaendig' }

function kurz(wert: string, laenge = 80): string {
  const sauber = wert.replace(/\s+/g, ' ').trim()
  return sauber.length <= laenge ? sauber : `${sauber.slice(0, laenge - 1).trimEnd()}…`
}

function zeileFuer({ treffer: t, anlass }: MeldeEintrag): string {
  const objekt = `Objekt „${kurz(t.objektBezeichnung) || 'ohne Bezeichnung'}“`
  const gesuch = `Gesuch „${kurz(t.gesuchTitel) || 'ohne Titel'}“${t.kundeName ? ` von ${kurz(t.kundeName, 60)}` : ''}`
  const was = t.passtKurz.length > 0 ? ` (${t.passtKurz.join(', ')})` : ''
  if (anlass === 'vollstaendig') return `• Jetzt vollständiger Treffer: ${objekt} passt zum ${gesuch}${was}`
  if (t.art === 'treffer') return `• ${objekt} passt zum ${gesuch}${was}`
  return `• ${objekt} könnte zum ${gesuch} passen${was} – noch zu prüfen: ${t.offen.join(', ')}`
}

/** Eine Nachricht für eine Person: alle ihre neuen Treffer dieses Laufs, höchstens acht ausgeschrieben.
 *  `privat`: Treffer eigener privater Gesuche (eigene Nachricht, Hinweis auf den Bereich Privat). */
export function trefferNachricht(eintraege: MeldeEintrag[], privat = false): string {
  // Erst die sicheren Treffer, dann die jetzt vollständigen, zuletzt die noch zu prüfenden.
  const rang = (e: MeldeEintrag) => (e.anlass === 'vollstaendig' ? 1 : e.treffer.art === 'treffer' ? 0 : 2)
  const sortiert = [...eintraege].sort((a, b) => rang(a) - rang(b))
  const zeilen = sortiert.slice(0, HOECHSTENS_ZEILEN).map(zeileFuer)
  const rest = sortiert.length - zeilen.length
  if (rest > 0) zeilen.push(rest === 1 ? '… und 1 weiterer' : `… und ${rest} weitere`)
  if (privat) {
    const kopf = sortiert.length === 1 ? 'Neuer Treffer zu deinen privaten Gesuchen:' : 'Neue Treffer zu deinen privaten Gesuchen:'
    return `${kopf}\n${zeilen.join('\n')}\n\nAnsehen im CRM im Bereich Privat.`
  }
  const kopf = sortiert.length === 1 ? 'Neuer Treffer in der Immobilienabteilung:' : 'Neue Treffer in der Immobilienabteilung:'
  return `${kopf}\n${zeilen.join('\n')}\n\nAnsehen im CRM unter Immobilien → Gesuche.`
}

// ---------------------------------------------------------------------------------------------
// Datenbank
// ---------------------------------------------------------------------------------------------

/** Liest eine Tabelle vollständig, seitenweise — unabhängig davon, wie viele Zeilen die Datenbank je
 *  Abruf höchstens herausgibt. Ein abgeschnittenes Ergebnis sähe sonst aus wie „passt nicht mehr“. */
// deno-lint-ignore no-explicit-any
async function ladeAlle(admin: Db, tabelle: string, spalten: string, art?: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const alle: any[] = []
  for (;;) {
    let abfrage = admin.from(tabelle).select(spalten)
    if (art) abfrage = abfrage.eq('art', art)
    const { data, error } = await abfrage.order('id').range(alle.length, alle.length + 999)
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    const seite = Array.isArray(data) ? data : []
    if (seite.length === 0) return alle
    alle.push(...seite)
  }
}

type Person = { name: string; chat: number | string }
/** Erreichbare Mitarbeiter (aktiv und mit Telegram verbunden): nach Namen (Mayer-Treffer) und nach Login-Adresse (private Treffer). */
type Erreichbare = { nachName: Map<string, Person>; nachAdresse: Map<string, Person> }

async function ladeErreichbare(admin: Db): Promise<Erreichbare> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, telegram_chat_id')
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  const nachName = new Map<string, Person>()
  const nachAdresse = new Map<string, Person>()
  for (const m of (data ?? []) as { name: string | null; email?: string | null; aktiv: boolean | null; telegram_chat_id: number | string | null }[]) {
    const name = text(m.name).trim()
    if (m.aktiv !== true || m.telegram_chat_id == null || m.telegram_chat_id === '') continue
    const person = { name: name || text(m.email).trim(), chat: m.telegram_chat_id }
    if (name) nachName.set(name.toLowerCase(), person)
    const adresse = normalisiereAdresse(m.email)
    if (adresse) nachAdresse.set(adresse, person)
  }
  return { nachName, nachAdresse }
}

/** Zeilen-art eines Treffers. */
function artVon(t: { besitzer?: string }): string {
  return t.besitzer ? ART_PRIVAT : ART_MAYER
}

/** Was in `abteilung_eintraege.daten` steht — bei privaten Treffern mit Besitzer. */
function meldungVon(t: BerechneterTreffer, art: 'treffer' | 'pruefen', entdecktAm: string, gemeldetAn: string[]): TrefferMeldung {
  return { id: t.id, gesuchId: t.gesuchId, kundeId: t.kundeId, objektId: t.objektId, art, entdecktAm, gemeldetAn, ...(t.besitzer ? { besitzer: t.besitzer } : {}) }
}

/** Mayer- und private Treffer zusammen lesen; je Zeile die art merken. */
async function ladeVorhandene(admin: Db): Promise<{ id: string; art: string; daten: unknown }[]> {
  const [mayer, privat] = await Promise.all([ladeAlle(admin, TABELLE, 'id, daten', ART_MAYER), ladeAlle(admin, TABELLE, 'id, daten', ART_PRIVAT)])
  return [...mayer.map((z) => ({ id: text(z.id), art: ART_MAYER, daten: z.daten })), ...privat.map((z) => ({ id: text(z.id), art: ART_PRIVAT, daten: z.daten }))]
}

const KUNDEN_SPALTEN = 'id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email, privat_art, gesuche, kaeuferprofil'
const OBJEKT_SPALTEN = 'id, bezeichnung, adresse, typ, kaufpreis, status, verantwortlich, zugewiesener_kunde, verkaufsdaten, activities, privat_besitzer'

function alsMeldung(daten: unknown): Partial<TrefferMeldung> {
  return alsObjekt(daten) ?? {}
}

function namenListe(wert: unknown): string[] {
  return Array.isArray(wert) ? wert.filter((n): n is string => typeof n === 'string') : []
}

// ---------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------

/** Vom Zeitplan jede Minute gerufen. Kehrt sofort zurück (`gelaufen: false`), solange seit dem
 *  letzten echten Lauf keine fünf Minuten vergangen sind (außer mit `ohneTakt`).
 *  `neu` zählt neu festgehaltene Paare (beim stillen Erststand alle) und Paare, die jetzt vollständig
 *  passen; `benachrichtigt` zählt die tatsächlich zugestellten Nachrichten (eine je Person).
 *  Wirft nie: Fehler der Datenbank stehen im Protokoll, der nächste Lauf versucht es erneut. */
export async function pruefeNeueTreffer(admin: Db, sende: SendeFunktion, optionen?: TrefferOptionen): Promise<TrefferErgebnis> {
  const ergebnis: TrefferErgebnis = { gelaufen: false, neu: 0, benachrichtigt: 0 }
  try {
    await lauf(admin, sende, optionen ?? {}, ergebnis)
  } catch (err) {
    console.error('Treffer-Prüfung (Gesuche und Objekte) fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return ergebnis
}

async function lauf(admin: Db, sende: SendeFunktion, optionen: TrefferOptionen, ergebnis: TrefferErgebnis): Promise<void> {
  const jetzt = optionen.jetzt ?? new Date()
  const jetztIso = jetzt.toISOString()

  // ---- Stand lesen, Takt einhalten ----
  const { data: standZeile, error: standFehler } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
  if (standFehler) throw new Error(`Stand nicht lesbar: ${standFehler.message}`)

  if (!standZeile) {
    await erststand(admin, jetztIso, ergebnis)
    return
  }

  const stand = alsObjekt(standZeile.daten) ?? {}
  const letzterLauf = typeof stand.letzterLauf === 'string' ? stand.letzterLauf : null
  if (!optionen.ohneTakt && letzterLauf) {
    const letzter = Date.parse(letzterLauf)
    // Betrag: Ein versehentlich in der Zukunft liegender Zeitpunkt darf die Prüfung nicht für immer anhalten.
    if (Number.isFinite(letzter) && Math.abs(jetzt.getTime() - letzter) < TAKT_MS) return
  }

  // ---- Den Lauf für sich beanspruchen: Nur wer den Zeitpunkt weiterstellt, prüft. Laufen zwei
  //      Aufrufe gleichzeitig, findet der zweite den alten Zeitpunkt nicht mehr vor und hört auf. ----
  let anspruch = admin
    .from(TABELLE)
    .update({ daten: { ...stand, letzterLauf: jetztIso, erststandAm: stand.erststandAm ?? jetztIso }, updated_at: jetztIso })
    .eq('id', STAND_ID)
  if (letzterLauf) anspruch = anspruch.eq('daten->>letzterLauf', letzterLauf)
  const { data: beansprucht, error: anspruchFehler } = await anspruch.select('id')
  if (anspruchFehler) throw new Error(`Stand nicht schreibbar: ${anspruchFehler.message}`)
  if (!Array.isArray(beansprucht) || beansprucht.length === 0) return
  ergebnis.gelaufen = true

  // ---- Alles lesen, bevor irgendetwas geschrieben wird: Schlägt ein Abruf fehl, bleibt alles, wie es ist. ----
  const [kunden, objekte, vorhandeneZeilen, team] = await Promise.all([
    ladeAlle(admin, 'kunden', KUNDEN_SPALTEN),
    ladeAlle(admin, 'objekte', OBJEKT_SPALTEN),
    ladeVorhandene(admin),
    ladeErreichbare(admin),
  ])

  const aktuelle = berechneTreffer(kunden, objekte)
  const aktuelleIds = new Set(aktuelle.map((t) => t.id))
  const vorhandene = new Map<string, { art: string; meldung: Partial<TrefferMeldung> }>()
  for (const z of vorhandeneZeilen) vorhandene.set(z.id, { art: z.art, meldung: alsMeldung(z.daten) })

  // ---- Neue Paare und Paare, die jetzt vollständig passen: erst festhalten, dann melden ----
  const zuMelden: MeldeEintrag[] = []
  const gespeichert = new Map<string, { art: string; meldung: TrefferMeldung }>()
  const stillAbwerten: { id: string; art: string; meldung: Partial<TrefferMeldung> }[] = []

  for (const t of aktuelle) {
    const art = artVon(t)
    let vorher = vorhandene.get(t.id)
    if (vorher && vorher.art !== art) {
      // Das Paar hat die Seite gewechselt (z. B. Kontakt nach Privat verschoben): alte Zeile weg, als neu behandeln.
      const { error } = await admin.from(TABELLE).delete().eq('id', t.id).eq('art', vorher.art)
      if (error) {
        console.error('Treffer nicht umstellbar:', t.id, error.message)
        continue
      }
      vorhandene.delete(t.id)
      vorher = undefined
    }
    const alt = vorher?.meldung
    if (!alt) {
      const meldung = meldungVon(t, t.art, jetztIso, [])
      const { error } = await admin.from(TABELLE).insert({ id: t.id, art, daten: meldung, updated_at: jetztIso })
      if (error) {
        // Gibt es die Zeile schon (ein anderer Lauf war schneller), wird nicht gemeldet. Bei jedem
        // anderen Fehler auch nicht — der nächste Lauf sieht das Paar wieder als neu.
        if (error.code !== '23505') console.error('Treffer nicht speicherbar:', t.id, error.message)
        continue
      }
      ergebnis.neu++
      gespeichert.set(t.id, { art, meldung })
      zuMelden.push({ treffer: t, anlass: 'neu' })
    } else if (alt.art === 'pruefen' && t.art === 'treffer') {
      // Der fehlende Wert ist nachgetragen. Der Zeitpunkt wird neu gesetzt, damit die Seite „Gesuche“
      // das Paar wieder unter „Neue Treffer“ zeigt.
      const meldung = meldungVon(t, 'treffer', jetztIso, namenListe(alt.gemeldetAn))
      const { data, error } = await admin.from(TABELLE).update({ daten: meldung, updated_at: jetztIso }).eq('id', t.id).eq('art', art).eq('daten->>art', 'pruefen').select('id')
      if (error) {
        console.error('Treffer nicht aktualisierbar:', t.id, error.message)
        continue
      }
      if (!Array.isArray(data) || data.length === 0) continue // ein anderer Lauf hat es schon gemeldet
      ergebnis.neu++
      gespeichert.set(t.id, { art, meldung })
      zuMelden.push({ treffer: t, anlass: 'vollstaendig' })
    } else if (alt.art === 'treffer' && t.art === 'pruefen') {
      stillAbwerten.push({ id: t.id, art, meldung: alt })
    }
  }

  // ---- Je Person eine Nachricht: Mayer-Treffer an die, die Objekt oder Kontakt betreuen; private
  //      Treffer nur an ihren Besitzer, in einer eigenen Nachricht ----
  const jePerson = new Map<string, { person: Person; privat: boolean; eintraege: MeldeEintrag[] }>()
  for (const eintrag of zuMelden) {
    const privat = !!eintrag.treffer.besitzer
    const empfaenger = privat
      ? [team.nachAdresse.get(eintrag.treffer.besitzer!)]
      : [eintrag.treffer.objektVerantwortlich, eintrag.treffer.kundeVerantwortlich].map((name) => team.nachName.get(name.trim().toLowerCase()))
    const schon = new Set<string>()
    for (const person of empfaenger) {
      if (!person) continue
      const schluessel = `${privat ? 'privat' : 'mayer'}|${person.chat}`
      if (schon.has(schluessel)) continue
      schon.add(schluessel)
      const sammlung = jePerson.get(schluessel) ?? { person, privat, eintraege: [] }
      sammlung.eintraege.push(eintrag)
      jePerson.set(schluessel, sammlung)
    }
  }

  const gemeldet = new Map<string, string[]>()
  for (const { person, privat, eintraege } of jePerson.values()) {
    let zugestellt = false
    try {
      zugestellt = (await sende(person.chat, trefferNachricht(eintraege, privat))) === true
    } catch (err) {
      console.error('Treffer-Nachricht nicht zustellbar:', err instanceof Error ? err.message : err)
    }
    if (!zugestellt) continue
    ergebnis.benachrichtigt++
    for (const e of eintraege) gemeldet.set(e.treffer.id, [...(gemeldet.get(e.treffer.id) ?? []), person.name])
  }

  // ---- Festhalten, wer Bescheid bekommen hat ----
  for (const [id, namen] of gemeldet) {
    const g = gespeichert.get(id)
    if (!g) continue
    const gemeldetAn = [...new Set([...g.meldung.gemeldetAn, ...namen])]
    const { error } = await admin.from(TABELLE).update({ daten: { ...g.meldung, gemeldetAn }, updated_at: jetztIso }).eq('id', id).eq('art', g.art)
    if (error) console.error('Empfänger am Treffer nicht vermerkbar:', id, error.message)
  }

  // ---- Still nachführen: Beim Objekt fehlt wieder eine Angabe (z. B. Kaufpreis gelöscht) ----
  for (const { id, art, meldung } of stillAbwerten) {
    const { error } = await admin.from(TABELLE).update({ daten: { ...meldung, art: 'pruefen' }, updated_at: jetztIso }).eq('id', id).eq('art', art).eq('daten->>art', 'treffer')
    if (error) console.error('Treffer nicht aktualisierbar:', id, error.message)
  }

  // ---- Paare, die nicht mehr passen, verschwinden ----
  for (const [id, { art }] of vorhandene) {
    if (aktuelleIds.has(id)) continue
    const { error } = await admin.from(TABELLE).delete().eq('id', id).eq('art', art)
    if (error) console.error('Treffer nicht löschbar:', id, error.message)
  }
}

/** Der allererste Lauf: alle vorhandenen Treffer still festhalten, niemanden benachrichtigen. */
async function erststand(admin: Db, jetztIso: string, ergebnis: TrefferErgebnis): Promise<void> {
  const [kunden, objekte, vorhandeneZeilen] = await Promise.all([
    ladeAlle(admin, 'kunden', KUNDEN_SPALTEN),
    ladeAlle(admin, 'objekte', OBJEKT_SPALTEN),
    ladeVorhandene(admin),
  ])

  // Liegen schon Zeilen vor (ein früherer Erststand brach mittendrin ab), bekommen die fehlenden
  // denselben Zeitpunkt — die Seite „Gesuche“ erkennt den Erststand am gemeinsamen ältesten Zeitpunkt.
  const schonDa = new Set<string>()
  let zeitpunkt = jetztIso
  for (const z of vorhandeneZeilen) {
    schonDa.add(z.id)
    const entdeckt = alsMeldung(z.daten).entdecktAm
    if (typeof entdeckt === 'string' && Number.isFinite(Date.parse(entdeckt)) && Date.parse(entdeckt) < Date.parse(zeitpunkt)) zeitpunkt = entdeckt
  }

  const fehlende = berechneTreffer(kunden, objekte)
    .filter((t) => !schonDa.has(t.id))
    .map((t) => ({ id: t.id, art: artVon(t), daten: meldungVon(t, t.art, zeitpunkt, []), updated_at: jetztIso }))
  for (let i = 0; i < fehlende.length; i += 200) {
    const { error } = await admin.from(TABELLE).upsert(fehlende.slice(i, i + 200), { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(`Erststand nicht speicherbar: ${error.message}`)
  }

  // Erst wenn alles festgehalten ist, gilt der Erststand als gemacht. Bricht der Lauf vorher ab,
  // wiederholt ihn der nächste Aufruf still — und niemand bekommt die alten Treffer gemeldet.
  const { error } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: { letzterLauf: jetztIso, erststandAm: jetztIso }, updated_at: jetztIso })
  if (error && error.code !== '23505') throw new Error(`Stand nicht speicherbar: ${error.message}`)
  ergebnis.gelaufen = true
  ergebnis.neu = fehlende.length
}
