// Renditepfad und Wertentwicklungs-Helfer für den AMH Investitionsfonds 2026
// Quelle: Prospekt "INVESTITIONSFONDS-AMH 2026" – Zielrendite, keine Garantie.

export type RenditeJahr = {
  jahr: number
  renditeProzent: number
  kommentar: string
}

export const RENDITEPFAD: RenditeJahr[] = [
  { jahr: 1, renditeProzent: 4, kommentar: 'Aufbau, Due Diligence, Cashreserve' },
  { jahr: 2, renditeProzent: 6, kommentar: 'Erste Exits, Hochlauf der Pipeline' },
  { jahr: 3, renditeProzent: 7, kommentar: 'Skalierung der Immobilien-Deals' },
  { jahr: 4, renditeProzent: 8, kommentar: 'Volle Allokation über alle Säulen' },
  { jahr: 5, renditeProzent: 8, kommentar: 'Volle Allokation über alle Säulen' },
  { jahr: 6, renditeProzent: 8, kommentar: 'Volle Allokation über alle Säulen' },
  { jahr: 7, renditeProzent: 8, kommentar: 'Volle Allokation über alle Säulen' },
  { jahr: 8, renditeProzent: 9, kommentar: 'Wiederanlage, Skaleneffekte' },
  { jahr: 9, renditeProzent: 10, kommentar: 'Reife Portfoliostruktur' },
  { jahr: 10, renditeProzent: 10, kommentar: 'Reife Portfoliostruktur' },
]

export type SzenarioId = 'worst' | 'base' | 'best'

export const SZENARIEN: { id: SzenarioId; label: string; anteil: number; renditeProzent: number; endindex: number }[] = [
  { id: 'worst', label: 'Worst Case', anteil: 10, renditeProzent: 3.0, endindex: 134 },
  { id: 'base', label: 'Base Case', anteil: 60, renditeProzent: 7.0, endindex: 196 },
  { id: 'best', label: 'Best Case', anteil: 30, renditeProzent: 14.0, endindex: 356 },
]

// Indexwerte (Start = 100) am Ende jedes Jahres, kumuliert entlang des Zielrenditepfads.
export const INDEXPFAD: { jahr: number; index: number }[] = (() => {
  let index = 100
  const out = [{ jahr: 0, index: 100 }]
  for (const r of RENDITEPFAD) {
    index = index * (1 + r.renditeProzent / 100)
    out.push({ jahr: r.jahr, index: Math.round(index * 100) / 100 })
  }
  return out
})()

export function indexAnJahren(jahreSeitStart: number): number {
  const clamped = Math.max(0, Math.min(10, jahreSeitStart))
  const lo = Math.floor(clamped)
  const hi = Math.ceil(clamped)
  const loIdx = INDEXPFAD[lo].index
  if (lo === hi) return loIdx
  const hiIdx = INDEXPFAD[hi].index
  const frac = clamped - lo
  return loIdx + (hiIdx - loIdx) * frac
}

export function jahreSeit(datumISO: string, referenzISO: string): number {
  const start = new Date(datumISO + 'T00:00:00').getTime()
  const ref = new Date(referenzISO + 'T00:00:00').getTime()
  return Math.max(0, (ref - start) / (1000 * 60 * 60 * 24 * 365))
}

export function aktuellerWert(betrag: number, zeichnungsdatumISO: string, referenzISO: string): number {
  const jahre = jahreSeit(zeichnungsdatumISO, referenzISO)
  const index = indexAnJahren(jahre)
  return (betrag * index) / 100
}

export function renditeSeitBeginnProzent(betrag: number, zeichnungsdatumISO: string, referenzISO: string): number {
  const wert = aktuellerWert(betrag, zeichnungsdatumISO, referenzISO)
  if (betrag <= 0) return 0
  return ((wert - betrag) / betrag) * 100
}
