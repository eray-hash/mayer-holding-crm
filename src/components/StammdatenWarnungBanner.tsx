import { AlertTriangle } from 'lucide-react'
import type { Kunde } from '../types'
import { istSammelakte } from '../data/sammelakten'

// Explizite Warnung bei fehlenden Stammdaten direkt in der Kundenakte (Punkt 11 der Bugfix-Liste,
// Ergänzung zur Benachrichtigungs-Glocke in Layout.tsx) — fällt sofort auf, sobald man den Kunden
// öffnet, statt nur in einer Liste irgendwo anders aufzutauchen.
export function StammdatenWarnungBanner({ kunde }: { kunde: Kunde }) {
  if (istSammelakte(kunde.id)) return null
  const fehlt: string[] = []
  if (!kunde.telefon?.trim()) fehlt.push('Telefonnummer')
  if (!kunde.email?.trim()) fehlt.push('E-Mail-Adresse')
  if (fehlt.length === 0) return null

  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
      <AlertTriangle size={15} className="flex-shrink-0" />
      Fehlende Stammdaten: {fehlt.join(', ')}
    </div>
  )
}
