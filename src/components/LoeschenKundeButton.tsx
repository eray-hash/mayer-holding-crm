import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { darfAkteSelbstLoeschen, istErstellerFrischerAkte } from '../../supabase/functions/_shared/akteSelbstLoeschen.ts'
import type { KundeBereich } from '../types'

// Direkter Löschen-Button in der Kundenakte, als Ergänzung zum bisherigen einzigen Weg (Pflege-Modus
// im KI-Assistenten bzw. jetzt auch per Telegram) — gleiche Berechtigung (nur Geschäftsführung/Admin)
// und immer erst mit Bestätigung, da nicht ohne Weiteres rückgängig zu machen.
// Seit 25.11.2026 auch für den Ersteller einer frischen Akte (höchstens 14 Tage, ohne Rechnungen/Kostenvoranschläge/
// Protokolle) — gleiche Regel wie im Telegram-Assistenten (_shared/akteSelbstLoeschen.ts); die Datenbank prüft sie
// in darf_akte_selbst_loeschen() (supabase/sql/2026-11-25_akte_selbst_loeschen.sql).
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
  const [selbst, setSelbst] = useState(false)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  // Privat ist pro Mitarbeiter isoliert (RLS) — dort darf der Besitzer seine eigenen Kontakte selbst
  // löschen, nicht nur Geschäftsführung/Admin wie in den gemeinsam genutzten Bereichen.
  const gfErlaubt =
    bereich === 'privat'
      ? true
      : isSupabaseConfigured && session
        ? mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin
        : state.rolle === 'geschaeftsfuehrung'

  // Ersteller einer frischen Akte: Knopf zeigen (Anhänge werden erst beim Löschen gezählt).
  useEffect(() => {
    setSelbst(false)
    if (gfErlaubt || !supabase || !session || !mitarbeiter) return
    let aktiv = true
    void (async () => {
      const { data } = await supabase.from('kunden').select('id, activities, verantwortlich, verantwortlich_email').eq('id', kundeId).maybeSingle()
      if (aktiv && data && istErstellerFrischerAkte(data, mitarbeiter).ok) setSelbst(true)
    })()
    return () => {
      aktiv = false
    }
  }, [gfErlaubt, kundeId, session, mitarbeiter])

  if (!gfErlaubt && !selbst) return null

  async function loeschen() {
    if (gfErlaubt) {
      dispatch({ type: 'PFLEGE_LOESCHE_KUNDE', id: kundeId, bereich })
      navigate(listePfad)
      return
    }
    // Ersteller: Regel frisch prüfen und selbst löschen — nur wenn die Datenbank die Zeile wirklich gelöscht hat,
    // verschwindet die Akte auch aus der Ansicht (sonst sähe es gelöscht aus und käme beim Neuladen zurück).
    if (!supabase || !mitarbeiter) return
    setLaeuft(true)
    setMeldung(null)
    try {
      const anzahl = async (tabelle: string) => {
        const { data, error } = await supabase!.from(tabelle).select('id').eq('kunde_id', kundeId).limit(20)
        return error ? 1 : (data ?? []).length
      }
      const [{ data: akte }, rechnungen, kostenvoranschlaege, protokolle] = await Promise.all([
        supabase.from('kunden').select('id, activities, verantwortlich, verantwortlich_email').eq('id', kundeId).maybeSingle(),
        anzahl('rechnungen'),
        anzahl('kostenvoranschlaege'),
        anzahl('protokolle'),
      ])
      const recht = akte ? darfAkteSelbstLoeschen(akte, mitarbeiter, { rechnungen, kostenvoranschlaege, protokolle }) : { ok: false as const, grund: 'Die Akte wurde nicht gefunden.' }
      if (!recht.ok) {
        setMeldung(`Nicht gelöscht: ${recht.grund} Bitte die Geschäftsführung, sie zu löschen.`)
        return
      }
      const { data: weg, error } = await supabase.from('kunden').delete().eq('id', kundeId).select('id')
      if (error || !weg || weg.length === 0) {
        setMeldung(`Nicht gelöscht${error ? ` (${error.message})` : ''}: Die Datenbank hat das Löschen abgelehnt. Bitte die Geschäftsführung, sie zu löschen.`)
        return
      }
      dispatch({ type: 'PFLEGE_LOESCHE_KUNDE', id: kundeId, bereich })
      navigate(listePfad)
    } finally {
      setLaeuft(false)
    }
  }

  if (meldung) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-rose-600">{meldung}</span>
        <button onClick={() => { setMeldung(null); setBestaetigen(false) }} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          OK
        </button>
      </div>
    )
  }

  if (bestaetigen) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-rose-600">„{kundeName}" wirklich löschen?{!gfErlaubt ? ' (selbst angelegte Akte)' : ''}</span>
        <button onClick={() => void loeschen()} disabled={laeuft} className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-50">
          {laeuft ? 'Lösche …' : 'Ja, löschen'}
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
