// Gesuche der Immobilienabteilung: wer sucht was — und der Abgleich mit dem Objektbestand in beide
// Richtungen (Gesuch → passende Objekte, Objekt → passende Gesuche). Bewusst einfache, nachvollziehbare
// Regeln statt einer Punktzahl: Jeder Treffer nennt, was passt und was noch offen ist.
import type { AppData } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import type { Gesuch, Kunde, KundeBereich, Objekt } from '../types'

export type GesuchMitKontakt = { gesuch: Gesuch; kunde: Kunde; bereich: KundeBereich }
export type ObjektTreffer = { objekt: Objekt; passt: string[]; offen: string[] }

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

/** Bei übernommenen Objekten steht im ersten Verlaufseintrag, wenn die Objektart nur ein Platzhalter ist. */
function artUngeprueft(o: Objekt): boolean {
  // Sobald im Verkaufsdatenblatt eine Objektart gewählt ist, gilt sie als geprüft.
  if (o.verkaufsdaten?.uebersicht.objektart) return false
  return o.activities.some((a) => a.id.startsWith('a_ql_') && /Noch nicht geprüft:[^.]*Objektart/.test(a.text))
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
export function pruefe(gesuch: Gesuch, o: Objekt): ObjektTreffer | null {
  if (NICHT_VERFUEGBAR.has(o.status) || o.zugewiesenerKunde) return null
  const passt: string[] = []
  const offen: string[] = []

  if (gesuch.objekttypen.length > 0) {
    if (artUngeprueft(o)) {
      // Aus einem Ordner übernommen, die Objektart ist nur ein Platzhalter: weder Treffer noch Ausschluss.
      offen.push('Objektart beim Objekt noch nicht geprüft')
    } else {
      if (!gesuch.objekttypen.includes(o.typ)) return null
      passt.push(`Objektart ${o.typ}`)
    }
  }

  const suchorte = orte(gesuch.lage)
  if (suchorte.length > 0) {
    const wo = `${o.adresse} ${o.bezeichnung}`.toLowerCase()
    const ort = suchorte.find((t) => wo.includes(t))
    if (!ort) return null
    passt.push(`Lage ${o.adresse || o.bezeichnung}`)
  }

  if (gesuch.budgetMin != null || gesuch.budgetMax != null) {
    if (o.kaufpreis > 0) {
      if (gesuch.budgetMin != null && o.kaufpreis < gesuch.budgetMin) return null
      if (gesuch.budgetMax != null && o.kaufpreis > gesuch.budgetMax) return null
      passt.push('Preis im Budget')
    } else {
      offen.push('Kaufpreis beim Objekt nicht hinterlegt')
    }
  }

  const kennzahlen: Record<string, unknown> | undefined = o.verkaufsdaten?.kennzahlen

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
    }
  }

  // Ein Gesuch ganz ohne Angaben würde auf alles passen — das hilft niemandem.
  if (passt.length === 0) return null
  return { objekt: o, passt, offen }
}

export function passendeObjekte(gesuch: Gesuch, objekte: Objekt[]): ObjektTreffer[] {
  if (gesuch.erledigt) return []
  return objekte
    .map((o) => pruefe(gesuch, o))
    .filter((t): t is ObjektTreffer => t !== null)
    .sort((x, y) => x.offen.length - y.offen.length || y.passt.length - x.passt.length)
}

/** Alle Gesuche aller Kontakte. Ein älteres „Käuferprofil" zählt als ein Gesuch mit. */
export function alleGesuche(state: AppData): GesuchMitKontakt[] {
  const liste: GesuchMitKontakt[] = []
  for (const def of KUNDEN_BEREICHE) {
    if (def.id === 'privat') continue
    for (const kunde of def.get(state)) {
      for (const gesuch of kunde.gesuche ?? []) liste.push({ gesuch, kunde, bereich: def.id })
      const p = kunde.kaeuferprofil
      if (p && (p.bevorzugteLage.trim() || p.objekttypen.length > 0 || p.budgetMin != null || p.budgetMax != null)) {
        liste.push({
          bereich: def.id,
          kunde,
          gesuch: {
            id: `kaeuferprofil:${kunde.id}`,
            erstelltAm: p.erstelltAm,
            titel: 'Käuferprofil',
            objekttypen: p.objekttypen,
            lage: p.bevorzugteLage,
            budgetMin: p.budgetMin,
            budgetMax: p.budgetMax,
            nutzung: p.nutzung,
            notizen: p.notizen,
          },
        })
      }
    }
  }
  return liste
}

export type GesuchTreffer = GesuchMitKontakt & { passt: string[]; offen: string[] }

/** Wer sucht so etwas wie dieses Objekt? */
export function passendeGesuche(objekt: Objekt, alle: GesuchMitKontakt[]): GesuchTreffer[] {
  const treffer: GesuchTreffer[] = []
  for (const g of alle) {
    if (g.gesuch.erledigt) continue
    const t = pruefe(g.gesuch, objekt)
    if (t) treffer.push({ ...g, passt: t.passt, offen: t.offen })
  }
  return treffer
}

export function budgetText(g: Gesuch): string {
  const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  if (g.budgetMin != null && g.budgetMax != null) return `${eur(g.budgetMin)} – ${eur(g.budgetMax)}`
  if (g.budgetMax != null) return `bis ${eur(g.budgetMax)}`
  if (g.budgetMin != null) return `ab ${eur(g.budgetMin)}`
  return '–'
}

/** Die weiteren Eckdaten eines Gesuchs in Kurzform („Faktor bis 20“, „ab 6 Einheiten“, „Baujahr 1990–2010“). Leer, wenn nichts davon gesetzt ist. */
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
