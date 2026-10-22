import type { AppData } from '../context/AppContext'
import type { KundeBereich } from '../types'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'

export type KundeMatch = { bereich: KundeBereich; kundeId: string; kundeName: string; score: number }

// Simples, aber echtes Text-Matching: findet den Kunden/Mandanten (über alle Bereiche hinweg),
// dessen Firmen-/Ansprechpartnername am häufigsten im übergebenen Text vorkommt. Wird sowohl beim
// Dokumenten-Import als auch beim E-Mail-Posteingang verwendet, damit beide dieselbe Logik teilen.
export function suggestKunde(state: AppData, text: string): KundeMatch | null {
  const tokens = text.toLowerCase().match(/[a-zäöüß]{3,}/g) ?? []
  if (tokens.length === 0) return null
  let best: KundeMatch | null = null
  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      const haystack = `${k.firma} ${k.ansprechpartner} ${k.email}`.toLowerCase()
      const score = tokens.filter((t) => haystack.includes(t)).length
      if (score > 0 && (!best || score > best.score)) {
        best = { bereich: b.id, kundeId: k.id, kundeName: `${k.firma} (${k.ansprechpartner})`, score }
      }
    }
  }
  return best
}

// Exakter Treffer per E-Mail-Adresse (für den Posteingang zuverlässiger als reines Text-Matching).
export function matchKundeByEmail(state: AppData, email: string): KundeMatch | null {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  for (const b of KUNDEN_BEREICHE) {
    const kunde = b.get(state).find((k) => k.email.trim().toLowerCase() === normalized)
    if (kunde) return { bereich: b.id, kundeId: kunde.id, kundeName: `${kunde.firma} (${kunde.ansprechpartner})`, score: 100 }
  }
  return null
}
