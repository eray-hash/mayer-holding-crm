import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Folder, FolderOpen, File, Upload, Plus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, Modal, Field, inputClass, PrimaryButton, EmptyState, StatusBadge } from '../../components/ui'
import { fmtDate, isOverdue, today, uid, fmtEUR } from '../../lib/dates'
import { PRIORITAETEN, gruppeLabel } from '../../data/constants'
import { DOKUMENT_ORDNER } from '../../types'
import type { DokumentOrdnerName, Prioritaet, FinanzierungStatus } from '../../types'

const TABS = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'finanzierung', label: 'Finanzierung' },
]

export function ObjektDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const [finOpen, setFinOpen] = useState(false)

  const objekt = state.objekte.find((o) => o.id === id)
  const tab = params.get('tab') ?? 'uebersicht'
  const ordner = params.get('ordner') as DokumentOrdnerName | null

  if (!objekt) {
    return (
      <div>
        <button onClick={() => navigate('/immobilien')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Objekt nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(objekt.followUp.date, objekt.followUp.done)
  const finanzierungen = state.finanzierungen.filter((f) => f.objektId === objekt.id)
  const objektId = objekt.id

  function setTab(t: string) {
    setParams({ tab: t })
  }

  function openOrdner(name: DokumentOrdnerName) {
    setParams({ tab: 'dokumente', ordner: name })
  }

  function uploadDummy(name: DokumentOrdnerName) {
    dispatch({
      type: 'ADD_DOKUMENT',
      objektId,
      ordner: name,
      dokument: { id: uid('doc'), name: `Neues_Dokument_${Math.floor(Math.random() * 900 + 100)}.pdf`, typ: 'PDF', datum: today(), groesse: '120 KB' },
    })
  }

  return (
    <div>
      <button onClick={() => navigate('/immobilien')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Objektliste
      </button>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{objekt.bezeichnung}</h1>
            <p className="text-sm text-slate-500">{objekt.adresse} · {gruppeLabel(objekt.gruppe)} · {objekt.typ}</p>
          </div>
          <select
            value={objekt.prioritaet}
            onChange={(e) => dispatch({ type: 'SET_OBJEKT_PRIORITAET', id: objekt.id, prioritaet: e.target.value as Prioritaet })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
          >
            {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget bereich="immobilien" status={objekt.status} onChange={(next) => dispatch({ type: 'SET_OBJEKT_STATUS', id: objekt.id, status: next })} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(objekt.followUp.date)} {overdue && '· überfällig'}</div>
            <div className="text-xs text-slate-400">{objekt.followUp.note}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Verantwortlich</div>
            <div className="text-sm text-slate-700">{objekt.verantwortlich}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Kaufpreis</div>
            <div className="text-sm text-slate-700">{fmtEUR(objekt.kaufpreis)}</div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Bezeichnung" value={objekt.bezeichnung} />
              <Row label="Adresse" value={objekt.adresse} />
              <Row label="Gruppe" value={gruppeLabel(objekt.gruppe)} />
              <Row label="Typ" value={objekt.typ} />
              <Row label="Kaufpreis" value={fmtEUR(objekt.kaufpreis)} />
              <Row label="Verantwortlich" value={objekt.verantwortlich} />
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(objekt.followUp.date)} — {objekt.followUp.note}</div>
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <ul className="space-y-3">
              {objekt.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
                  <div>
                    <div className="text-slate-700">{a.text}</div>
                    <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.user}</div>
                  </div>
                </li>
              ))}
              {objekt.activities.length === 0 && <EmptyState text="Keine Aktivitäten." />}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'dokumente' && !ordner && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {DOKUMENT_ORDNER.map((name) => {
            const count = objekt.dokumente[name]?.length ?? 0
            return (
              <button
                key={name}
                onClick={() => openOrdner(name)}
                className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-accent-300 hover:shadow"
              >
                <Folder size={22} className="text-accent-500" />
                <span className="text-sm font-medium text-slate-700">{name}</span>
                <span className="text-xs text-slate-400">{count} Dokument{count === 1 ? '' : 'e'}</span>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'dokumente' && ordner && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setParams({ tab: 'dokumente' })} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
              <FolderOpen size={16} className="text-accent-500" /> {ordner}
            </button>
            <button onClick={() => uploadDummy(ordner)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Upload size={13} /> Datei hochladen
            </button>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Name</th><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Datum</th><th className="px-4 py-3">Größe</th>
                </tr>
              </thead>
              <tbody>
                {(objekt.dokumente[ordner] ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-700"><span className="flex items-center gap-2"><File size={14} className="text-slate-400" />{d.name}</span></td>
                    <td className="px-4 py-3 text-slate-500">{d.typ}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(d.datum)}</td>
                    <td className="px-4 py-3 text-slate-500">{d.groesse}</td>
                  </tr>
                ))}
                {(objekt.dokumente[ordner] ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Keine Dateien in diesem Ordner.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === 'finanzierung' && (
        <div>
          <div className="mb-3 flex justify-end">
            <PrimaryButton onClick={() => setFinOpen(true)}><Plus size={14} /> Finanzierung anlegen</PrimaryButton>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Bank/Partner</th><th className="px-4 py-3">Darlehenssumme</th><th className="px-4 py-3">Zinssatz</th><th className="px-4 py-3">Laufzeit</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Ansprechpartner</th>
                </tr>
              </thead>
              <tbody>
                {finanzierungen.map((f) => (
                  <tr key={f.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-700">{f.bank}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtEUR(f.darlehenssumme)}</td>
                    <td className="px-4 py-3 text-slate-500">{f.zinssatz.toFixed(1)} %</td>
                    <td className="px-4 py-3 text-slate-500">{f.laufzeit}</td>
                    <td className="px-4 py-3"><StatusBadge label={f.status} color={finStatusColor(f.status)} /></td>
                    <td className="px-4 py-3 text-slate-500">{f.ansprechpartner}</td>
                  </tr>
                ))}
                {finanzierungen.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Keine Finanzierungen verknüpft.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <Modal open={finOpen} onClose={() => setFinOpen(false)} title="Finanzierung anlegen">
        <FinanzierungForm
          onSubmit={(f) => {
            dispatch({ type: 'ADD_FINANZIERUNG', finanzierung: { ...f, id: uid('f'), objektId: objekt.id } })
            setFinOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}

export function finStatusColor(status: FinanzierungStatus): string {
  const colors: Record<FinanzierungStatus, string> = {
    Angefragt: 'bg-slate-100 text-slate-600',
    'In Prüfung': 'bg-amber-100 text-amber-700',
    Zugesagt: 'bg-emerald-100 text-emerald-700',
    Abgelehnt: 'bg-rose-100 text-rose-700',
    Ausgezahlt: 'bg-sky-100 text-sky-700',
  }
  return colors[status]
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value}</dd>
    </div>
  )
}

function FinanzierungForm({ onSubmit }: { onSubmit: (f: { bank: string; darlehenssumme: number; zinssatz: number; laufzeit: string; status: FinanzierungStatus; ansprechpartner: string }) => void }) {
  const [bank, setBank] = useState('')
  const [darlehenssumme, setDarlehenssumme] = useState(300000)
  const [zinssatz, setZinssatz] = useState(3.5)
  const [laufzeit, setLaufzeit] = useState('20 Jahre')
  const [status, setStatus] = useState<FinanzierungStatus>('Angefragt')
  const [ansprechpartner, setAnsprechpartner] = useState('')

  return (
    <div>
      <Field label="Bank / Partner"><input className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
      <Field label="Darlehenssumme (€)"><input type="number" className={inputClass} value={darlehenssumme} onChange={(e) => setDarlehenssumme(Number(e.target.value))} /></Field>
      <Field label="Zinssatz (%)"><input type="number" step="0.1" className={inputClass} value={zinssatz} onChange={(e) => setZinssatz(Number(e.target.value))} /></Field>
      <Field label="Laufzeit"><input className={inputClass} value={laufzeit} onChange={(e) => setLaufzeit(e.target.value)} /></Field>
      <Field label="Status">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as FinanzierungStatus)}>
          <option>Angefragt</option><option>In Prüfung</option><option>Zugesagt</option><option>Abgelehnt</option><option>Ausgezahlt</option>
        </select>
      </Field>
      <Field label="Ansprechpartner"><input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={() => onSubmit({ bank, darlehenssumme, zinssatz, laufzeit, status, ansprechpartner })}>Speichern</PrimaryButton>
      </div>
    </div>
  )
}
