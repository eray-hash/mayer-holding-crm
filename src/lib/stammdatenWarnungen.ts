import type { AppData } from '../context/AppContext'
import { istSammelakte } from '../data/sammelakten'
import type { KundeBereich } from '../types'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'

export type StammdatenWarnung = {
  bereich: KundeBereich
  kundeId: string
  kundeName: string
  bereichLabel: string
  fehlendeFelder: string[]
}

// Explizite Warnung bei fehlenden Stammdaten (Punkt 11 der Bugfix-Liste) — sammelt alle
// Kunden/Mandanten über alle Bereiche hinweg, bei denen Telefon oder E-Mail fehlt. Nur diese zwei
// Felder, da sie für jede Kontaktaufnahme unverzichtbar sind; andere optionale Felder lösen bewusst
// keine Warnung aus, um die Liste nicht mit Rauschen zu fluten.
export function collectFehlendeStammdaten(state: AppData): StammdatenWarnung[] {
  const out: StammdatenWarnung[] = []
  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      if (istSammelakte(k.id)) continue
      const fehlendeFelder: string[] = []
      if (!k.telefon?.trim()) fehlendeFelder.push('Telefon')
      if (!k.email?.trim()) fehlendeFelder.push('E-Mail')
      if (fehlendeFelder.length > 0) {
        out.push({ bereich: b.id, kundeId: k.id, kundeName: `${k.firma} (${k.ansprechpartner})`, bereichLabel: b.label, fehlendeFelder })
      }
    }
  }
  return out
}
