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
  return o.activities.some((a) => a.id.startsWith('a_ql_') && /Noch nicht geprüft:[^.]*Objektart/.test(a.text))
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
