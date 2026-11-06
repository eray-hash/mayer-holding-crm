import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, Modal, EmptyState } from '../../components/ui'
import { FollowUpForm } from '../../components/FollowUpEditor'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
import { GespraechsprotokolleSection } from '../../components/GespraechsprotokolleSection'
import { PotenzialAnalyseSection } from '../../components/PotenzialAnalyseSection'
import { KaeuferprofilSection } from '../../components/KaeuferprofilSection'
import { SelbstauskunftSection } from '../../components/SelbstauskunftSection'
import { NdaSection } from '../../components/NdaSection'
import { DokumenteSection } from '../../components/DokumenteSection'
import { KommunikationSection } from '../../components/KommunikationSection'
import { LoeschenKundeButton } from '../../components/LoeschenKundeButton'
import type { Prioritaet } from '../../types'

export function PrivatDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const [editFollowUp, setEditFollowUp] = useState(false)

  const kontakt = state.privatKunden.find((k) => k.id === id)

  if (!kontakt) {
    return (
      <div>
        <button onClick={() => navigate('/privat')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Kontakt nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(kontakt.followUp.date, kontakt.followUp.done)

  return (
    <div>
      <button onClick={() => navigate('/privat')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zu meinen Kontakten
      </button>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{kontakt.firma}</h1>
            <p className="text-sm text-slate-500">{kontakt.email} · {kontakt.telefon}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kontakt.prioritaet}
              onChange={(e) => dispatch({ type: 'SET_PRIVAT_PRIORITAET', id: kontakt.id, prioritaet: e.target.value as Prioritaet })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <LoeschenKundeButton bereich="privat" kundeId={kontakt.id} kundeName={kontakt.firma} listePfad="/privat" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="privat"
              status={kontakt.status}
              onChange={(next) => dispatch({ type: 'SET_PRIVAT_STATUS', id: kontakt.id, status: next })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <button onClick={() => setEditFollowUp(true)} className="text-left">
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} {overdue && '· überfällig'}</div>
              <div className="text-xs text-slate-400">{kontakt.followUp.note}</div>
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={kontakt.firma} />
            <Row label="Zusatz" value={kontakt.ansprechpartner} />
            <Row label="E-Mail" value={kontakt.email} />
            <Row label="Telefon" value={kontakt.telefon} />
          </dl>
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
            <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} — {kontakt.followUp.note}</div>
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
          <ul className="space-y-3">
            {kontakt.activities.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
                <div>
                  <div className="text-slate-700">{a.text}</div>
                  <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.user}</div>
                </div>
              </li>
            ))}
            {kontakt.activities.length === 0 && <EmptyState text="Keine Aktivitäten." />}
          </ul>
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Gesprächsprotokolle</h3>
          <GespraechsprotokolleSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Potenzial-Analyse</h3>
          <PotenzialAnalyseSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Käuferprofil</h3>
          <KaeuferprofilSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Selbstauskunft</h3>
          <SelbstauskunftSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">NDA</h3>
          <NdaSection bereich="privat" kundeId={kontakt.id} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Dokumente</h3>
          <DokumenteSection bereich="privat" kundeId={kontakt.id} />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Kommunikation</h3>
          <KommunikationSection kundeId={kontakt.id} />
        </Card>
      </div>

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={kontakt.followUp.date}
          note={kontakt.followUp.note}
          done={kontakt.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'SET_PRIVAT_FOLLOWUP', id: kontakt.id, followUp })
            setEditFollowUp(false)
          }}
        />
      </Modal>
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
