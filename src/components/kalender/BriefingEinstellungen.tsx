import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

// Termin-Briefing per Telegram (verschickt vom Server, supabase/functions/email-gateway/terminBriefing.ts):
// vor jedem Termin, der mit einer Kunden- oder Objektakte verbunden ist, eine kurze Zusammenfassung der Akte
// (Stand, letzte Kontakte, Offenes, fehlende Unterlagen, Gesprächspunkte). Gespeichert in der eigenen Zeile
// von kalender_einstellungen — nur die eigenen Spalten, damit Erinnerungen, Sichtbarkeit und Abo-Kennung
// unberührt bleiben. Keine Zeile = Standard (an, 60 Minuten vorher, keine Morgenübersicht).

type Werte = { briefing_an: boolean; briefing_vorlauf: number; briefing_morgen: boolean }

const STANDARD: Werte = { briefing_an: true, briefing_vorlauf: 60, briefing_morgen: false }
const VORLAUF_WAHL = [15, 30, 45, 60, 90, 120]

function vorlaufText(m: number): string {
  if (m < 60) return `${m} Minuten vorher`
  if (m === 60) return '1 Stunde vorher'
  return m % 60 === 0 ? `${m / 60} Stunden vorher` : `${Math.floor(m / 60)} Std. ${m % 60} Min. vorher`
}

export function BriefingEinstellungen({ ich }: { ich: string }) {
  const email = (ich ?? '').trim().toLowerCase()
  const [werte, setWerte] = useState<Werte | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!supabase || !email) return
    let aktiv = true
    supabase
      .from('kalender_einstellungen')
      .select('briefing_an, briefing_vorlauf, briefing_morgen')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv) return
        if (error) {
          setFehler('Die Einstellungen zum Termin-Briefing konnten nicht geladen werden.')
          return
        }
        setWerte({
          briefing_an: data?.briefing_an !== false,
          briefing_vorlauf: VORLAUF_WAHL.includes(Number(data?.briefing_vorlauf)) ? Number(data?.briefing_vorlauf) : STANDARD.briefing_vorlauf,
          briefing_morgen: data?.briefing_morgen === true,
        })
      })
    return () => {
      aktiv = false
    }
  }, [email])

  async function speichern(aenderung: Partial<Werte>) {
    if (!supabase || !email || !werte) return
    const vorher = werte
    setWerte({ ...werte, ...aenderung })
    setFehler('')
    try {
      const zeile = { ...aenderung, geaendert_am: new Date().toISOString() }
      const { data, error } = await supabase.from('kalender_einstellungen').update(zeile).eq('email', email).select('email')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        // Noch keine eigene Zeile: mit denselben Grundwerten anlegen wie der Kalender.
        const { error: anlegeFehler } = await supabase.from('kalender_einstellungen').insert({ email, erinnerungen: [60], sichtbar: true, ...zeile })
        if (anlegeFehler && anlegeFehler.code !== '23505') throw new Error(anlegeFehler.message)
        if (anlegeFehler) {
          // Gleichzeitig angelegt (z. B. im Profil): dann nur die eigenen Spalten ändern.
          const { data: zweite, error: zweiter } = await supabase.from('kalender_einstellungen').update(zeile).eq('email', email).select('email')
          if (zweiter || !zweite?.length) throw new Error(zweiter?.message ?? 'nicht gespeichert')
        }
      }
    } catch {
      setWerte(vorher)
      setFehler('Die Einstellung konnte nicht gespeichert werden. Bitte später noch einmal versuchen.')
    }
  }

  if (!werte) return fehler ? <p className="mt-3 text-xs font-medium text-rose-600">{fehler}</p> : null

  return (
    <div className="mt-5">
      <p className="mb-2 text-sm font-medium text-slate-700">Termin-Briefing per Telegram</p>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={werte.briefing_an} onChange={(e) => speichern({ briefing_an: e.target.checked })} />
        <span>
          Vor Kundenterminen eine Zusammenfassung der Akte
          <span className="block text-xs text-slate-500">
            Für Termine, die mit einer Kunden- oder Objektakte verbunden sind: Stand, letzte Kontakte, Offenes, fehlende Unterlagen und Vorschläge für das Gespräch.
          </span>
        </span>
      </label>
      {werte.briefing_an && (
        <div className="ml-6 mt-2 space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span>Wann:</span>
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
              value={werte.briefing_vorlauf}
              onChange={(e) => speichern({ briefing_vorlauf: Number(e.target.value) })}
            >
              {VORLAUF_WAHL.map((m) => (
                <option key={m} value={m}>
                  {vorlaufText(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={werte.briefing_morgen} onChange={(e) => speichern({ briefing_morgen: e.target.checked })} />
            <span>
              Zusätzlich um 7:30 Uhr alle Kundentermine des Tages
              <span className="block text-xs text-slate-500">Kurzfassung je Termin. Ohne Kundentermin kommt keine Nachricht.</span>
            </span>
          </label>
        </div>
      )}
      {fehler && <p className="mt-2 text-xs font-medium text-rose-600">{fehler}</p>}
    </div>
  )
}
