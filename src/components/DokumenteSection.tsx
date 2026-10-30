import { FileText } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card, EmptyState } from './ui'
import type { KundeBereich } from '../types'

// Dokumente, die der Kunden-/Mandantenakte zugeordnet wurden — aktuell befüllt durch E-Mail-Anhänge
// beim Zuordnen einer E-Mail (siehe ASSIGN_EINGEGANGENE_EMAIL in AppContext.tsx). Bewusst eine
// flache Liste ohne Ordner-Kategorisierung wie bei Immobilien-Objekten, da hier nicht nötig.
export function DokumenteSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const dokumente = kunde?.dokumente ?? []

  if (dokumente.length === 0) {
    return <EmptyState text="Noch keine Dokumente — z. B. automatisch aus zugeordneten E-Mail-Anhängen." />
  }

  return (
    <Card className="divide-y divide-slate-100 overflow-hidden">
      {dokumente.map((d) => (
        <a
          key={d.id}
          href={d.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50"
        >
          <FileText size={16} className="flex-shrink-0 text-slate-400" />
          <span className="flex-1 truncate font-medium text-slate-700">{d.name}</span>
          <span className="flex-shrink-0 text-xs text-slate-400">{d.groesse}</span>
          <span className="flex-shrink-0 text-xs text-slate-400">{d.datum}</span>
        </a>
      ))}
    </Card>
  )
}
