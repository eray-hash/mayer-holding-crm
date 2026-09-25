import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, EmptyState } from '../../components/ui'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
import { ERBEN_CHECKLISTE } from '../../data/seedErben'
import { FormularLinkButtons } from '../../components/FormularLink'
import type { Prioritaet } from '../../types'

const TABS = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'unterlagen', label: 'Unterlagen-Checkliste' },
]

export function ErbenDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()

  const mandant = state.erbenMandanten.find((k) => k.id === id)
  const tab = params.get('tab') ?? 'uebersicht'

  if (!mandant) {
    return (
      <div>
        <button onClick={() => navigate('/erben')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Mandant nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(mandant.followUp.date, mandant.followUp.done)
  const checkliste = mandant.unterlagenCheckliste ?? {}

  function toggleCheck(key: string) {
    if (!mandant) return
    dispatch({
      type: 'UPDATE_ERBEN_MANDANT',
      id: mandant.id,
      patch: { unterlagenCheckliste: { ...checkliste, [key]: !checkliste[key] } },
    })
  }

  const alleItems = ERBEN_CHECKLISTE.flatMap((g) => g.punkte)
  const erledigtCount = alleItems.filter((_, i) => checkliste[alleItems[i]]).length

  return (
    <div>
      <button onClick={() => navigate('/erben')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Mandantenliste
      </button>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{mandant.firma}</h1>
            <p className="text-sm text-slate-500">{mandant.ansprechpartner} · {mandant.email} · {mandant.telefon}</p>
          </div>
          <select
            value={mandant.prioritaet}
            onChange={(e) => dispatch({ type: 'SET_ERBEN_PRIORITAET', id: mandant.id, prioritaet: e.target.value as Prioritaet })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
          >
            {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget bereich="erben" status={mandant.status} onChange={(next) => dispatch({ type: 'SET_ERBEN_STATUS', id: mandant.id, status: next })} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(mandant.followUp.date)} {overdue && '· überfällig'}</div>
            <div className="text-xs text-slate-400">{mandant.followUp.note}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Verantwortlich</div>
            <div className="text-sm text-slate-700">{mandant.verantwortlich}</div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.id === 'unterlagen' && <span className="ml-1.5 text-xs text-slate-400">({erledigtCount}/{alleItems.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Mandant/Familie" value={mandant.firma} />
              <Row label="Ansprechpartner" value={mandant.ansprechpartner} />
              <Row label="E-Mail" value={mandant.email} />
              <Row label="Telefon" value={mandant.telefon} />
              <Row label="Verantwortlich" value={mandant.verantwortlich} />
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(mandant.followUp.date)} — {mandant.followUp.note}</div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-1.5 text-xs font-medium text-slate-400">Allgemeine Vollmacht digital versenden</div>
              <FormularLinkButtons pfad={`/formular/vollmacht/erben/${mandant.id}`} />
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <ul className="space-y-3">
              {mandant.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
                  <div>
                    <div className="text-slate-700">{a.text}</div>
                    <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.user}</div>
                  </div>
                </li>
              ))}
              {mandant.activities.length === 0 && <EmptyState text="Keine Aktivitäten." />}
            </ul>
          </Card>

          {mandant.signaturen && mandant.signaturen.length > 0 && (
            <Card className="p-5 lg:col-span-3">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Erfasste Unterschriften</h3>
              <div className="flex flex-wrap gap-4">
                {mandant.signaturen.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <img src={s.dataUrl} alt={`Unterschrift ${s.name}`} className="h-20 rounded bg-white" />
                    <div className="mt-1.5 text-xs text-slate-500">{s.kontext}</div>
                    <div className="text-xs text-slate-400">{s.name} · {fmtDate(s.datum)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'unterlagen' && (
        <Card className="p-5">
          <p className="mb-4 text-sm text-slate-500">
            Checkliste aus dem Mandantenfragebogen „Vermögens-, Familien- und Nachfolgeplanung" — hier wird festgehalten,
            welche Angaben/Unterlagen vom Mandanten bereits vorliegen.
          </p>
          <div className="space-y-5">
            {ERBEN_CHECKLISTE.map((gruppe) => (
              <div key={gruppe.kategorie}>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">{gruppe.kategorie}</h4>
                <div className="space-y-1.5">
                  {gruppe.punkte.map((punkt) => (
                    <label key={punkt} className="flex items-start gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!checkliste[punkt]}
                        onChange={() => toggleCheck(punkt)}
                        className="mt-0.5 rounded"
                      />
                      <span className={checkliste[punkt] ? 'text-slate-400 line-through' : ''}>{punkt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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
