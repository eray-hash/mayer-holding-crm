// Schalter für die Telegram-Meldungen zum Tagesablauf (Tabelle tagesplan_einstellungen, eigene Zeile):
// „Dein Tag“ werktags um 7:45 und „Offen geblieben“ um 17:30. Keine Zeile = aus.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

type Stand = { morgen: boolean; abend: boolean }

export function TelegramEinstellung({ email }: { email: string }) {
  const [stand, setStand] = useState<Stand | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!supabase || !email) return
    let abgebrochen = false
    supabase
      .from('tagesplan_einstellungen')
      .select('morgen_an, abend_an')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (abgebrochen) return
        if (error) setFehler('Die Einstellung ist noch nicht verfügbar.')
        else setStand({ morgen: data?.morgen_an === true, abend: data?.abend_an === true })
      })
    return () => {
      abgebrochen = true
    }
  }, [email])

  async function setze(neu: Stand) {
    if (!supabase) return
    const alt = stand
    setStand(neu)
    setFehler('')
    const { error } = await supabase.from('tagesplan_einstellungen').upsert({ email, morgen_an: neu.morgen, abend_an: neu.abend, geaendert_am: new Date().toISOString() })
    if (error) {
      setStand(alt)
      setFehler('Konnte nicht gespeichert werden.')
    }
  }

  if (!stand && !fehler) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="font-medium text-slate-500">Telegram:</span>
      {stand && (
        <>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4" checked={stand.morgen} onChange={(e) => setze({ ...stand, morgen: e.target.checked })} />
            „Dein Tag“ werktags 7:45
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4" checked={stand.abend} onChange={(e) => setze({ ...stand, abend: e.target.checked })} />
            „Offen geblieben“ 17:30
          </label>
        </>
      )}
      {fehler && <span className="text-slate-400">{fehler}</span>}
    </div>
  )
}
