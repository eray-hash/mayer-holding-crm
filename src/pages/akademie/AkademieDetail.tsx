import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, EmptyState } from '../../components/ui'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
import { ZugewieseneObjekte } from '../../components/ZugewieseneObjekte'
import type { Prioritaet } from '../../types'

export function AkademieDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()

  const teilnehmer = state.akademieTeilnehmer.find((k) => k.id === id)

  if (!teilnehmer) {
    return (
      <div>
        <button onClick={() => navigate('/akademie')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Teilnehmer nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(teilnehmer.followUp.date, teilnehmer.followUp.done)

  return (
    <div>
      <button onClick={() => navigate('/akademie')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Teilnehmerliste
      </button>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{teilnehmer.firma}</h1>
            <p className="text-sm text-slate-500">{teilnehmer.email} · {teilnehmer.telefon}</p>
          </div>
          <select
            value={teilnehmer.prioritaet}
            onChange={(e) => dispatch({ type: 'SET_AKADEMIE_PRIORITAET', id: teilnehmer.id, prioritaet: e.target.value as Prioritaet })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
          >
            {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="akademie"
              status={teilnehmer.status}
              onChange={(next) => dispatch({ type: 'SET_AKADEMIE_STATUS', id: teilnehmer.id, status: next })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(teilnehmer.followUp.date)} {overdue && '· überfällig'}</div>
            <div className="text-xs text-slate-400">{teilnehmer.followUp.note}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Verantwortlich</div>
            <div className="text-sm text-slate-700">{teilnehmer.verantwortlich}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={teilnehmer.firma} />
            <Row label="E-Mail" value={teilnehmer.email} />
            <Row label="Telefon" value={teilnehmer.telefon} />
            <Row label="Verantwortlich" value={teilnehmer.verantwortlich} />
          </dl>
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
            <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(teilnehmer.followUp.date)} — {teilnehmer.followUp.note}</div>
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
          <ul className="space-y-3">
            {teilnehmer.activities.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
                <div>
                  <div className="text-slate-700">{a.text}</div>
                  <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.user}</div>
                </div>
              </li>
            ))}
            {teilnehmer.activities.length === 0 && <EmptyState text="Keine Aktivitäten." />}
          </ul>
        </Card>

        <ZugewieseneObjekte bereich="akademie" kundeId={teilnehmer.id} />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value}</dd>
    </div>
  )
}
