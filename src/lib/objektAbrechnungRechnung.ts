// Die Rechnung der Objekt-Abrechnung für den gespeicherten Stand, ohne Bildschirm: erfasste Zeit je
// Person, Zeitkosten über den Stundensatz und Aufteilung der Provision (feste Anteile, der Rest nach
// Zeitanteil; Rundungsrest in Cent an den größten Anteil). Gleiche Regeln wie im Reiter „Abrechnung"
// (components/ObjektAbrechnungSection.tsx), der dieselbe Rechnung für den gerade eingetippten Entwurf
// macht. Ändert sich dort eine Regel, muss sie hier mitgeändert werden.

import type { ObjektAbrechnung, Zeiteintrag } from '../types'

const runde2 = (n: number) => Math.round(n * 100) / 100
const gueltig = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

export type AbrechnungPerson = {
  name: string
  /** Erfasste Zeit in Minuten. */
  min: number
  anzahl: number
  /** Stundensatz in Euro; undefined = nicht eingetragen. */
  satz?: number
  /** Fester Anteil in Prozent; undefined = nach Zeit. */
  fest?: number
  /** Zeitkosten in Euro; null solange kein Stundensatz eingetragen ist. */
  kosten: number | null
  /** Anteil an der erfassten Zeit in Prozent. */
  zeitanteil: number
  /** Anteil an der Provision in Prozent. */
  anteil: number
  /** Anteil an der Provision in Euro; null solange keine Provision eingetragen ist. */
  betrag: number | null
}

export type AbrechnungErgebnis = {
  provision?: number
  personen: AbrechnungPerson[]
  gesamtMin: number
  kostenGesamt: number
}

/** Rechnet die Abrechnung eines Objekts aus seinen Zeiteinträgen und der gespeicherten Abrechnung. */
export function rechneObjektAbrechnung(objektId: string, zeiteintraege: Zeiteintrag[], gespeicherte?: ObjektAbrechnung): AbrechnungErgebnis {
  const jePerson = new Map<string, { min: number; anzahl: number }>()
  for (const z of zeiteintraege) {
    if (z.objektId !== objektId) continue
    const name = (z.mitarbeiter ?? '').trim() || 'Ohne Namen'
    const min = Math.max(0, Math.round(Number(z.dauerMin) || 0))
    const p = jePerson.get(name) ?? { min: 0, anzahl: 0 }
    p.min += min
    p.anzahl += 1
    jePerson.set(name, p)
  }
  const mitZeit = [...jePerson.entries()].sort(([a, x], [b, y]) => y.min - x.min || a.localeCompare(b)).map(([name]) => name)
  const saetze = gespeicherte?.stundensaetze ?? {}
  const anteile = gespeicherte?.anteile ?? {}
  const ohneZeit = [...new Set([...Object.keys(saetze), ...Object.keys(anteile)])].filter((n) => !jePerson.has(n))
  const namen = [...mitZeit, ...ohneZeit]

  const provision = gueltig(gespeicherte?.provision) ? runde2(gespeicherte!.provision!) : undefined
  const gesamtMin = mitZeit.reduce((s, n) => s + (jePerson.get(n)?.min ?? 0), 0)
  const grund = namen.map((name) => {
    const zeit = jePerson.get(name) ?? { min: 0, anzahl: 0 }
    return { name, ...zeit, satz: gueltig(saetze[name]) ? saetze[name] : undefined, fest: gueltig(anteile[name]) ? anteile[name] : undefined }
  })
  const summeFest = grund.reduce((s, g) => s + (g.fest ?? 0), 0)
  const restProzent = Math.max(0, 100 - summeFest)
  const freieMin = grund.reduce((s, g) => s + (g.fest === undefined ? g.min : 0), 0)
  const ohneBetrag = grund.map((g) => ({
    ...g,
    kosten: g.satz !== undefined ? runde2((g.min / 60) * g.satz) : null,
    zeitanteil: gesamtMin > 0 ? (g.min / gesamtMin) * 100 : 0,
    anteil: g.fest !== undefined ? g.fest : freieMin > 0 ? (restProzent * g.min) / freieMin : 0,
  }))
  const verteilt = ohneBetrag.reduce((s, z) => s + z.anteil, 0)
  const cent = ohneBetrag.map((z) => (provision === undefined ? 0 : Math.round(provision * z.anteil)))
  if (provision !== undefined && cent.length > 0 && Math.abs(verteilt - 100) < 1e-6) {
    const rest = Math.round(provision * 100) - cent.reduce((s, c) => s + c, 0)
    cent[cent.indexOf(Math.max(...cent))] += rest
  }
  const personen: AbrechnungPerson[] = ohneBetrag.map((z, i) => ({ ...z, betrag: provision === undefined ? null : cent[i] / 100 }))
  return { provision, personen, gesamtMin, kostenGesamt: runde2(personen.reduce((s, p) => s + (p.kosten ?? 0), 0)) }
}
