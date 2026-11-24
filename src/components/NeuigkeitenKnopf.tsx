// Symbol „Neu im CRM“ in der Kopfleiste (23.11.2026) mit der Zahl der ungelesenen Neuerungen, die den
// Angemeldeten betreffen. Klick öffnet /neuigkeiten. Ohne Tabellen (SQL noch nicht eingespielt) bleibt das
// Symbol ohne Zahl. Gemeinsamer Stand: lib/neuigkeiten.ts.

import { Megaphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNeuigkeiten } from '../lib/neuigkeiten'
import { KopfHinweis } from './KopfHinweis'

export function NeuigkeitenKnopf() {
  const navigate = useNavigate()
  const { verfuegbar, ungelesen } = useNeuigkeiten()
  const anzahl = verfuegbar ? ungelesen.length : 0
  const titel = anzahl > 0 ? `Neu im CRM: ${anzahl} ${anzahl === 1 ? 'Neuerung' : 'Neuerungen'}, die du noch nicht kennst` : 'Neu im CRM'
  return (
    <KopfHinweis text={titel} rechts>
      <button
        onClick={() => navigate('/neuigkeiten')}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label={titel}
      >
        <Megaphone size={16} />
        {anzahl > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-amber-950">
            {anzahl > 99 ? '99+' : anzahl}
          </span>
        )}
      </button>
    </KopfHinweis>
  )
}
