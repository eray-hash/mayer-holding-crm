// „Ansehen als …“ (nur Superuser, seit 19.11.2026): Das CRM so ansehen, wie ein Kollege es sieht —
// gleiche Bereiche, gleiche Menüs, gleiche „eigenen“ Listen, aber NUR LESEND.
// - Zustand: lib/ansichtAlsStore.ts (nur im Speicher dieses Fensters; Neuladen beendet die Ansicht).
// - Sicht: AuthContext liefert die angesehene Person als `mitarbeiter`, AppContext filtert den Stand
//   (lib/ansichtFilter.ts).
// - Sperre: lib/nurLesen.ts weist jeden schreibenden Netzwerkaufruf ab, AppContext jede Änderung im
//   Stand. Beides prüft den Schalter bei jedem Aufruf.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, X } from 'lucide-react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabaseClient'
import { beendeAnsicht, starteAnsicht, type AnsichtPerson } from '../lib/ansichtAlsStore'
import { beiGesperrt } from '../lib/nurLesen'

/** Leiste ganz oben, solange die Ansicht läuft — plus kurzer Hinweis, wenn etwas gespeichert werden sollte. */
export function AnsichtAlsBanner() {
  const { ansichtAls } = useAuth()
  const [hinweis, setHinweis] = useState('')
  const navigate = useNavigate()

  useEffect(
    () =>
      beiGesperrt((m) => {
        setHinweis(m)
        window.setTimeout(() => setHinweis(''), 3500)
      }),
    [],
  )

  if (!ansichtAls) return null
  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-amber-500 px-3 py-1.5 text-sm font-medium text-white sm:px-4">
        <span className="flex min-w-0 items-center gap-2">
          <Eye size={15} className="flex-shrink-0" />
          <span className="truncate">Du siehst das CRM wie {ansichtAls.name} – nur lesend.</span>
        </span>
        <button
          onClick={() => {
            beendeAnsicht()
            navigate('/heute')
          }}
          className="flex-shrink-0 rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30"
        >
          Beenden
        </button>
      </div>
      {hinweis && (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{hinweis}</div>
      )}
    </>
  )
}

/** Auswahl der Person. Lädt die aktiven Mitarbeiter (nur lesend) und startet die Ansicht. */
export function AnsichtAlsAuswahl({ onClose }: { onClose: () => void }) {
  const { echterMitarbeiter, istSuperuser } = useAuth()
  const [personen, setPersonen] = useState<AnsichtPerson[]>([])
  const [fehler, setFehler] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase || !istSuperuser) return
    supabase
      .from('mitarbeiter')
      .select('id, name, email, rolle, bereiche, aktiv, ist_admin, telefon, signatur_html, foto_data_url, buchungslink, ist_superuser')
      .eq('aktiv', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) setFehler('Die Mitarbeiter ließen sich nicht laden.')
        else setPersonen(((data ?? []) as AnsichtPerson[]).filter((p) => p.id !== echterMitarbeiter?.id))
      })
  }, [istSuperuser, echterMitarbeiter?.id])

  if (!istSuperuser) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Ansehen als …</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Du siehst das CRM genau so, wie diese Person es sieht. Nur lesend: In dieser Ansicht wird nichts gespeichert, gesendet oder gelöscht.
        </p>
        {fehler && <p className="mb-2 text-sm text-red-600">{fehler}</p>}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {personen.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                starteAnsicht(p)
                onClose()
                navigate('/heute')
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium text-slate-800">{p.name}</span>
              <span className="text-xs text-slate-400">
                {p.rolle === 'geschaeftsfuehrung' || p.ist_admin ? 'alle Bereiche' : `${(p.bereiche ?? []).length} Bereich${(p.bereiche ?? []).length === 1 ? '' : 'e'}`}
              </span>
            </button>
          ))}
          {personen.length === 0 && !fehler && <p className="px-3 py-2 text-sm text-slate-400">Lädt …</p>}
        </div>
      </div>
    </div>
  )
}
