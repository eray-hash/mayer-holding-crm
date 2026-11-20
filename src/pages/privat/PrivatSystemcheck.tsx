import { useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { callAuthenticated } from '../../lib/emailGateway'
import { useMsStatus } from '../../lib/microsoftKonto'

type Pruefung = { name: string; ok: boolean | null; text: string }

/** Bereich Privat → Systemcheck: prüft alle Bausteine des Assistenten mit einem Klick. */
export function PrivatSystemcheck() {
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  const [liste, setListe] = useState<Pruefung[] | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')

  const pruefe = async () => {
    setLaedt(true)
    setFehler('')
    try {
      setListe((await callAuthenticated({ action: 'privat_systemcheck' })).pruefungen ?? [])
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }
  useEffect(() => {
    if (status?.erlaubt) pruefe()
  }, [status?.erlaubt])

  if (ansichtAls) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Wird in dieser Ansicht nicht gezeigt.</div>
  if (!status) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!status.erlaubt) return <p className="text-sm text-slate-500">Für dein Konto nicht freigeschaltet.</p>

  const gruen = liste?.filter((p) => p.ok === true).length ?? 0
  const rot = liste?.filter((p) => p.ok === false).length ?? 0

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Systemcheck</h1>
          {liste && <p className="text-sm text-slate-500">{rot === 0 ? `Alles in Ordnung (${gruen} Prüfungen grün).` : `${rot} Punkt(e) brauchen Aufmerksamkeit.`}</p>}
        </div>
        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Erneut prüfen" onClick={pruefe} disabled={laedt}>
          <RefreshCw size={16} className={laedt ? 'animate-spin' : ''} />
        </button>
      </div>
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
      {!liste && !fehler && <p className="text-sm text-slate-400">Wird geprüft …</p>}
      {liste && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {liste.map((p) => (
            <li key={p.name} className="flex items-start gap-3 px-4 py-3">
              {p.ok === true ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : p.ok === false ? <XCircle size={18} className="mt-0.5 shrink-0 text-rose-500" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-slate-400" />}
              <div>
                <div className="text-sm font-medium text-slate-800">{p.name}</div>
                <div className="text-xs text-slate-500">{p.text}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
