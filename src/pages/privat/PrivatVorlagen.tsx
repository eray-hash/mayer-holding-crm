import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { useMsStatus } from '../../lib/microsoftKonto'
import { PRIVAT_ARTEN, privatArtInfo } from '../../data/privatArten'
import { VorlagenListe } from '../../components/VorlagenListe'
import { inputClass } from '../../components/ui'

const ARTEN = [
  { kind: 'vollmacht', label: 'Vollmacht' },
  { kind: 'schreiben', label: 'Schreiben' },
  { kind: 'vertraege', label: 'Verträge' },
]

/**
 * Bereich Privat → Vorlagen: die Vorlagen der Mayer-Bereiche zum Ausfüllen für die eigenen privaten Kunden
 * (Kunde wählen, PDF oder „Auf Briefbogen“). Die Vorlagen selbst sind die gemeinsamen des jeweiligen Bereichs.
 */
export function PrivatVorlagen() {
  const { art, kind } = useParams()
  const navigate = useNavigate()
  const { state } = useApp()
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  const info = privatArtInfo(art)
  if (!info) return <Navigate to="/privat/vorlagen/beratung/vollmacht" replace />
  if (status && !status.erlaubt) return <Navigate to="/privat" replace />
  const k = kind ?? 'vollmacht'

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Vorlagen</h1>
        <select className={`${inputClass} w-auto`} value={info.id} onChange={(e) => navigate(`/privat/vorlagen/${e.target.value}/${k}`)} title="Bereich">
          {PRIVAT_ARTEN.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {ARTEN.map((a) => (
            <button
              key={a.kind}
              onClick={() => navigate(`/privat/vorlagen/${info.id}/${a.kind}`)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${k === a.kind ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-sm text-slate-500">Die Vorlagen des Bereichs {info.label}. Beim Ausfüllen kannst du deine privaten Kunden wählen; mit „Auf Briefbogen“ entsteht das Schreiben auf deinem Briefbogen.</p>
      <VorlagenListe kategorie={k} vorlagen={state[info.vorlagenKey]} />
    </div>
  )
}
