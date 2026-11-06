import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import type { KundeBereich } from '../types'

// Direkter Löschen-Button in der Kundenakte, als Ergänzung zum bisherigen einzigen Weg (Pflege-Modus
// im KI-Assistenten bzw. jetzt auch per Telegram) — gleiche Berechtigung (nur Geschäftsführung/Admin)
// und immer erst mit Bestätigung, da nicht ohne Weiteres rückgängig zu machen.
export function LoeschenKundeButton({
  bereich,
  kundeId,
  kundeName,
  listePfad,
}: {
  bereich: KundeBereich
  kundeId: string
  kundeName: string
  listePfad: string
}) {
  const { dispatch, state } = useApp()
  const { session, mitarbeiter } = useAuth()
  const navigate = useNavigate()
  const [bestaetigen, setBestaetigen] = useState(false)

  const erlaubt = isSupabaseConfigured && session
    ? mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin
    : state.rolle === 'geschaeftsfuehrung'
  if (!erlaubt) return null

  function loeschen() {
    dispatch({ type: 'PFLEGE_LOESCHE_KUNDE', id: kundeId, bereich })
    navigate(listePfad)
  }

  if (bestaetigen) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-rose-600">„{kundeName}" wirklich löschen?</span>
        <button onClick={loeschen} className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700">
          Ja, löschen
        </button>
        <button onClick={() => setBestaetigen(false)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          Abbrechen
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setBestaetigen(true)}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
      title={`${kundeName} löschen`}
    >
      <Trash2 size={13} /> Löschen
    </button>
  )
}
