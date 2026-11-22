import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

// Erinnerung „Gespräch aufnehmen?“ zum Terminbeginn (Runde 5, verschickt vom Server im Minutentakt,
// supabase/functions/email-gateway/terminBriefing.ts, beimTerminbeginn): bei Terminen mit Kunden- oder Objektakte
// zum Beginn eine Telegram-Nachricht mit dem Direkt-Link in die Gesprächs-App. Spalte
// kalender_einstellungen.gespraech_erinnerung, Standard aus. Geschrieben wird nur diese Spalte der eigenen Zeile
// (wie BriefingEinstellungen); fehlt die Spalte noch (SQL nicht eingespielt), bleibt der Schalter weg.

export function AufnahmeErinnerungEinstellung({ ich }: { ich: string }) {
  const email = (ich ?? '').trim().toLowerCase()
  const [an, setAn] = useState<boolean | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!supabase || !email) return
    let aktiv = true
    supabase
      .from('kalender_einstellungen')
      .select('gespraech_erinnerung')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv || error) return // Spalte fehlt: Schalter ausblenden
        setAn((data as { gespraech_erinnerung?: boolean | null } | null)?.gespraech_erinnerung === true)
      })
    return () => {
      aktiv = false
    }
  }, [email])

  async function speichern(wert: boolean) {
    if (!supabase || !email || an === null) return
    const vorher = an
    setAn(wert)
    setFehler('')
    try {
      const zeile = { gespraech_erinnerung: wert, geaendert_am: new Date().toISOString() }
      const { data, error } = await supabase.from('kalender_einstellungen').update(zeile).eq('email', email).select('email')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        // Noch keine eigene Zeile: mit denselben Grundwerten anlegen wie der Kalender.
        const { error: anlegeFehler } = await supabase.from('kalender_einstellungen').insert({ email, erinnerungen: [60], sichtbar: true, ...zeile })
        if (anlegeFehler && anlegeFehler.code !== '23505') throw new Error(anlegeFehler.message)
        if (anlegeFehler) {
          const { data: zweite, error: zweiter } = await supabase.from('kalender_einstellungen').update(zeile).eq('email', email).select('email')
          if (zweiter || !zweite?.length) throw new Error(zweiter?.message ?? 'nicht gespeichert')
        }
      }
    } catch {
      setAn(vorher)
      setFehler('Die Einstellung konnte nicht gespeichert werden. Bitte später noch einmal versuchen.')
    }
  }

  if (an === null) return null

  return (
    <div className="mt-3">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={an} onChange={(e) => speichern(e.target.checked)} />
        <span>
          Beim Termin an Aufnahme erinnern
          <span className="block text-xs text-slate-500">
            Zum Beginn eines Termins mit Kunden- oder Objektakte kommt per Telegram ein Link, der die App „Mayer Gespräch“ mit dieser Akte öffnet — ein Tipp, Einwilligung bestätigen, aufnehmen.
          </span>
        </span>
      </label>
      {fehler && <p className="mt-2 text-xs font-medium text-rose-600">{fehler}</p>}
    </div>
  )
}
